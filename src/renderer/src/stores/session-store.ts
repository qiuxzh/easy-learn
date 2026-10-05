import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Usage } from '@shared/types/chat';
import type {
  AppUIMessage,
  AppUIMessagePart,
  AppReasoningPart,
  AppTextPart,
  AppToolCallPart,
  AppToolResultPart,
} from '@/types/message';
import { BatchBuffer } from '@/utils/batch-buffer';
import {
  appendTextDelta,
  getLastAssistantMessage,
  isCompactionPart,
  markStreamingAsAbort,
  markStreamingAsDone,
  sessionEntriesToAppMessages,
} from '@/utils/message-util';

/**
 * sessionStore：聊天渲染层使用的消息状态中心。
 *
 * 设计要点：
 * - 以会话 id（sessionId，前端生成）为粒度存储
 * - 每个会话独立持有 messages / isStreaming / isOccupied
 * - 所有写入操作都对 immer 草稿进行，调用方可以直接"修改"对象
 * - 文本/思考增量在本 store 内部节流合并，调用方只需逐条投喂 delta
 * - 该 store 不负责事件路由，事件分发由 chatStreamController 负责
 */

/** 参与增量写入的 part 类型。 */
export type DeltaPartType = 'text' | 'reasoning';

/** 一次运行的结局，随 agent_end 传入。 */
export type RunOutcome =
  | { type: 'done' }
  | { type: 'abort' }
  | { type: 'error'; errorText: string };

/** 一次上下文压缩的结局。 */
export type CompactionNoticeOutcome =
  | { type: 'done' }
  | { type: 'error'; errorText: string }
  /** 被中断：上下文没有变化，提示直接撤掉 */
  | { type: 'aborted' };

/** 增量缓冲的合并窗口，单位毫秒。 */
const DELTA_FLUSH_INTERVAL = 200;

/** 单个会话在渲染层所需的全部状态。 */
export interface SessionData {
  /** 已渲染的消息列表，按时间顺序追加。 */
  messages: AppUIMessage[];
  /** 当前是否处于流式响应中。 */
  isStreaming: boolean;
  /** 是否正被某个 Chat 组件占有。同一会话同一时刻只允许一个 Chat 组件显示。 */
  isOccupied: boolean;
}

interface SessionState {
  /** 会话 id → 该会话的状态。 */
  sessionsMap: Record<string, SessionData>;

  // ───────── 会话生命周期 ─────────
  /** 从主进程载入该会话的完整日志并转换为 UI 消息。 */
  loadSession: (sessionId: string) => Promise<void>;
  /** 标记会话被当前 Chat 组件占有；已被占有则返回 false。 */
  claimSession: (sessionId: string) => boolean;
  /** 解除占用；若会话为空闲且无消息，则一并删除该条目。 */
  releaseSession: (sessionId: string) => boolean;
  /** 无条件删除本地会话缓存。 */
  removeSession: (sessionId: string) => void;

  // ───────── 运行生命周期 ─────────
  /**
   * 用户发送消息时调用：置 isStreaming、置 isOccupied。
   * 不写消息——用户消息与助手消息一样由内核事件驱动渲染。
   * 若发送失败，需要配套调用 rollbackRequest 回滚。
   */
  beginRequest: (sessionId: string) => void;
  /** 发送失败时回滚：清流式与占用标志，无消息的空会话则删除。 */
  rollbackRequest: (sessionId: string) => void;
  /** 置会话的流式标志。 */
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
  /** 一次运行结束：按结局收尾消息、清 isStreaming、空闲则删除。 */
  endRun: (sessionId: string, outcome: RunOutcome) => void;
  /** 单个 turn 结束：把当前 turn 的 streaming part 标记完成。 */
  finishStep: (sessionId: string) => void;

  // ───────── 消息内容追加（流式事件驱动） ─────────
  /** 追加一条用户消息：既用于本次发送的提示词，也用于运行中注入的 steering / follow-up。 */
  appendUserMessage: (sessionId: string, message: AppUIMessage) => void;
  /** 追加一条空的 assistant 消息，对应助手消息开始。 */
  appendAssistantMessage: (sessionId: string) => void;
  /** 在最后一条 assistant 上追加一个空的 streaming part（text 或 reasoning）。 */
  appendStreamingPart: (sessionId: string, partType: DeltaPartType) => void;
  /** 追加增量内容，由内部缓冲节流后写入对应的 streaming part。 */
  appendPartDelta: (sessionId: string, partType: DeltaPartType, delta: string) => void;
  /** 在最后一条 assistant 上追加 tool-call part。 */
  appendToolCall: (sessionId: string, part: Omit<AppToolCallPart, 'type'>) => void;
  /** 在最后一条 assistant 上追加 tool-result part。 */
  appendToolResult: (sessionId: string, part: Omit<AppToolResultPart, 'type'>) => void;
  /** 把 token 用量挂到最后一条 assistant 消息上，对应一次 turn 的请求结束。 */
  setLastAssistantUsage: (sessionId: string, usage: Usage) => void;

  // ───────── 上下文压缩提示 ─────────
  /** 追加一条"正在压缩上下文"的系统提示。 */
  beginCompactionNotice: (sessionId: string) => void;
  /** 结束最近一条压缩提示：落定结果、标记失败，或（被中断时）直接撤掉。 */
  endCompactionNotice: (sessionId: string, outcome: CompactionNoticeOutcome) => void;
}

/** 若会话条目不存在则按默认值初始化并返回。 */
function ensureSessionData(
  sessionsMap: Record<string, SessionData>,
  sessionId: string
): SessionData {
  if (!sessionsMap[sessionId]) {
    sessionsMap[sessionId] = {
      messages: [],
      isStreaming: false,
      isOccupied: false,
    };
  }
  return sessionsMap[sessionId];
}

/** 在指定会话的"最后一条 assistant 消息"上追加一个 part。 */
function appendPartToLastAssistant(
  sessionsMap: Record<string, SessionData>,
  sessionId: string,
  part: AppUIMessagePart
): void {
  const session = sessionsMap[sessionId];
  if (!session) return;

  const lastMessage = session.messages[session.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') return;
  lastMessage.parts.push(part);
}

/**
 * 取得会话最后一条 assistant 消息；没有则补一条空的。
 * 用于运行在产出任何消息前就失败时，仍有一个容器承载错误提示。
 */
function ensureLastAssistant(session: SessionData): AppUIMessage {
  const lastAssistant = getLastAssistantMessage(session.messages);
  if (lastAssistant) return lastAssistant;

  const created: AppUIMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [],
  };
  session.messages.push(created);
  return created;
}

/** 把会话中最后一条 assistant 消息的所有 streaming part 标记为 done。 */
function markLastAssistantAsDone(
  sessionsMap: Record<string, SessionData>,
  sessionId: string
): void {
  const session = sessionsMap[sessionId];
  if (!session) return;

  const lastAssistant = getLastAssistantMessage(session.messages);
  if (!lastAssistant) return;
  markStreamingAsDone(lastAssistant.parts);
}

/**
 * 当会话既不在流式、也没被占用时，删除该条目以释放内存。
 * 返回是否真的执行了删除。
 */
function deleteSessionIfIdle(sessionsMap: Record<string, SessionData>, sessionId: string): boolean {
  const session = sessionsMap[sessionId];
  if (!session) return false;
  if (session.isStreaming || session.isOccupied) return false;

  delete sessionsMap[sessionId];
  return true;
}

/** 找会话里最后一条还处于"压缩中"的提示消息。 */
function findStreamingCompactionNotice(session: SessionData): AppUIMessage | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role !== 'system') continue;
    const part = message.parts.find(isCompactionPart);
    if (part?.state === 'streaming') return message;
  }
  return undefined;
}

export const useSessionStore = create<SessionState>()(
  immer(set => {
    /** 每种增量各持一个缓冲：同一会话的高频 delta 合并后一次性写入。 */
    const createDeltaBuffer = (partType: DeltaPartType): BatchBuffer =>
      new BatchBuffer(entries => {
        for (const [sessionId, delta] of entries) {
          set(state => {
            const session = state.sessionsMap[sessionId];
            if (session) appendTextDelta(session.messages, partType, delta);
          });
        }
      }, DELTA_FLUSH_INTERVAL);

    const deltaBuffers: Record<DeltaPartType, BatchBuffer> = {
      text: createDeltaBuffer('text'),
      reasoning: createDeltaBuffer('reasoning'),
    };

    /** 把攒着的增量立即落定。会改变消息归属的操作之前必须先调用。 */
    const flushDeltas = (): void => {
      deltaBuffers.text.flushImmediate();
      deltaBuffers.reasoning.flushImmediate();
    };

    return {
      sessionsMap: {},

      loadSession: async sessionId => {
        try {
          const { entries, run } = await window.api.openSession({ sessionId });
          set(state => {
            state.sessionsMap[sessionId] = {
              messages: sessionEntriesToAppMessages(entries),
              isStreaming: run.isRunning,
              isOccupied: false,
            };
          });
        } catch {
          /* ignore */
        }
      },

      beginRequest: sessionId => {
        flushDeltas();
        set(state => {
          const session = ensureSessionData(state.sessionsMap, sessionId);
          session.isStreaming = true;
          session.isOccupied = true;
        });
      },

      rollbackRequest: sessionId => {
        flushDeltas();
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.isStreaming = false;
          session.isOccupied = false;
          // 完全空白的会话直接删除，避免遗留垃圾数据
          if (session.messages.length === 0) {
            delete state.sessionsMap[sessionId];
          }
        });
      },

      setStreaming: (sessionId, isStreaming) => {
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;
          session.isStreaming = isStreaming;
        });
      },

      endRun: (sessionId, outcome) => {
        flushDeltas();
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.isStreaming = false;

          if (outcome.type === 'done') {
            markLastAssistantAsDone(state.sessionsMap, sessionId);
          } else {
            const lastAssistant = ensureLastAssistant(session);
            markStreamingAsAbort(lastAssistant.parts);
            lastAssistant.parts.push(
              outcome.type === 'abort'
                ? { type: 'abort' }
                : { type: 'error', errorText: outcome.errorText }
            );
          }

          deleteSessionIfIdle(state.sessionsMap, sessionId);
        });
      },

      finishStep: sessionId => {
        flushDeltas();
        set(state => {
          markLastAssistantAsDone(state.sessionsMap, sessionId);
        });
      },

      appendUserMessage: (sessionId, message) => {
        // 新消息会成为"最后一条消息"，先把攒着的增量落到上一条上
        flushDeltas();
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.messages.push(message);
        });
      },

      appendAssistantMessage: sessionId => {
        // 新消息会成为"最后一条消息"，先把攒着的增量落到上一条上
        flushDeltas();
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [],
          });
        });
      },

      appendStreamingPart: (sessionId, partType) => {
        // 新 part 会成为增量的落点，先把攒着的内容写进上一个 part，避免错位
        flushDeltas();

        const part: AppTextPart | AppReasoningPart =
          partType === 'text'
            ? { type: 'text', text: '', state: 'streaming' }
            : { type: 'reasoning', text: '', state: 'streaming' };

        set(state => {
          appendPartToLastAssistant(state.sessionsMap, sessionId, part);
        });
      },

      appendPartDelta: (sessionId, partType, delta) => {
        deltaBuffers[partType].push(sessionId, delta);
      },

      appendToolCall: (sessionId, part) => {
        set(state => {
          appendPartToLastAssistant(state.sessionsMap, sessionId, { type: 'tool-call', ...part });
        });
      },

      appendToolResult: (sessionId, part) => {
        set(state => {
          appendPartToLastAssistant(state.sessionsMap, sessionId, { type: 'tool-result', ...part });
        });
      },

      setLastAssistantUsage: (sessionId, usage) => {
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          const lastAssistant = getLastAssistantMessage(session.messages);
          if (!lastAssistant) return;
          lastAssistant.usage = usage;
        });
      },

      beginCompactionNotice: sessionId => {
        // 插入新消息会改变"最后一条消息"，先把攒着的增量落定
        flushDeltas();
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.messages.push({
            id: crypto.randomUUID(),
            role: 'system',
            parts: [{ type: 'compaction', state: 'streaming' }],
          });
        });
      },

      endCompactionNotice: (sessionId, outcome) => {
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          const notice = findStreamingCompactionNotice(session);
          if (!notice) return;

          if (outcome.type === 'aborted') {
            // 压缩被中断时上下文没有变化，撤掉提示，避免留下一行永远转圈的占位
            session.messages.splice(session.messages.indexOf(notice), 1);
            return;
          }

          notice.parts =
            outcome.type === 'done'
              ? [{ type: 'compaction', state: 'done' }]
              : [{ type: 'compaction', state: 'error', errorText: outcome.errorText }];
        });
      },

      claimSession: sessionId => {
        let success = false;
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;
          if (session.isOccupied) {
            success = false;
            return;
          }

          session.isOccupied = true;
          success = true;
        });
        return success;
      },

      releaseSession: sessionId => {
        let deleted = false;
        set(state => {
          const session = state.sessionsMap[sessionId];
          if (!session) return;

          session.isOccupied = false;
          deleted = deleteSessionIfIdle(state.sessionsMap, sessionId);
        });
        return deleted;
      },

      removeSession: sessionId => {
        set(state => {
          delete state.sessionsMap[sessionId];
        });
      },
    };
  })
);
