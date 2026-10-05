import { ipcMain } from 'electron';
import { isDeepStrictEqual } from 'util';
import type {
  AgentSessionEvent,
  ChatEventPayload,
  DeleteSessionRequest,
  OpenSessionRequest,
  OpenSessionResult,
  RenameSessionRequest,
  SessionSummary,
  StreamAbortRequest,
  StreamAbortResponse,
  StreamSendRequest,
  StreamSendResponse,
  ThinkingLevel,
} from '@shared/types/chat';
import { IpcChannel } from '@shared/ipc-channels';
import { AgentSession } from '@main/agent/common-agent/agent-session';
import { createAgentSession } from '@main/agent/common-agent/create-agent-session';
import { loadSessionEntries } from '@main/agent/common-agent/session-manager';
import { ModelRuntime } from '@main/agent/model/model-runtime';
import { configService } from '@main/config/config-service';
import { agentSessionRepo } from '@main/db/repo';
import type { AgentSessionRow } from '@main/db/repo';
import { BaseService } from '@main/service/base-service';
import { getMainWindow } from '@main/window';
import { readingAgent } from './reading-agent';
import { buildChatSystemPrompt } from '@main/chat/system-prompts';

/** 会话标题最多保留的字数，超出部分截断。 */
const TITLE_MAX_LENGTH = 30;

/** 由首条消息压缩出会话标题。 */
function titleFromText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
}

/**
 * 会话服务：前端与 agent 内核之间的唯一入口。
 * 负责会话的增删改查、运行时池管理，以及把内核事件转发给渲染层。
 */
export class SessionService extends BaseService {
  /** 活跃会话运行时池，一个 sessionId 对应一个 AgentSession。 */
  private readonly sessions = new Map<string, AgentSession>();

  /** 模型配置运行时，全进程共用一份；配置变更后调用 reload 即可生效。 */
  private readonly modelRuntime = ModelRuntime.create(() => configService.get('models'));

  constructor() {
    super();

    let previousModels = configService.get('models');
    configService.subscribeChange(snapshot => {
      if (isDeepStrictEqual(previousModels, snapshot.config.models)) return;

      previousModels = snapshot.config.models;
      this.modelRuntime.reload();
    });
  }

  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Chat_ListSessionSummary, async () => this.listSessionSummary());
    ipcMain.handle(IpcChannel.Chat_OpenSession, async (_, req: OpenSessionRequest) =>
      this.openSession(req)
    );
    ipcMain.handle(IpcChannel.Chat_RenameSession, async (_, req: RenameSessionRequest) =>
      this.renameSession(req)
    );
    ipcMain.handle(IpcChannel.Chat_DeleteSession, async (_, req: DeleteSessionRequest) =>
      this.deleteSession(req)
    );
    ipcMain.handle(IpcChannel.Chat_StreamSend, async (_, req: StreamSendRequest) =>
      this.streamSend(req)
    );
    ipcMain.handle(IpcChannel.Chat_StreamAbort, async (_, req: StreamAbortRequest) =>
      this.streamAbort(req)
    );
  }

  /**
   * 把会话事件推送给渲染层。
   * 所有会话的事件都会推送，后端不感知前端当前打开了哪个会话。
   */
  emitEvent(sessionId: string, event: AgentSessionEvent): void {
    const payload: ChatEventPayload = { sessionId, event };
    getMainWindow()?.webContents.send(IpcChannel.Chat_Event, payload);
  }

  /**
   * 会话摘要列表，按 updatedAt 倒序。
   * 只含元数据，运行态取自运行时池，不加载消息内容。
   */
  listSessionSummary(): SessionSummary[] {
    return agentSessionRepo.findAll().map(row => this.toSummary(row));
  }

  /**
   * 打开会话：返回摘要、完整日志与运行态快照。
   * 只读库、不建立运行时——浏览历史无需为模型准备上下文，也避免运行时池随浏览无限增长。
   * 会话正在运行时，快照额外带上尚未落库的那条助手消息，前端据此无缝续看。
   */
  openSession(req: OpenSessionRequest): OpenSessionResult {
    const row = agentSessionRepo.findById(req.sessionId);
    if (!row) {
      throw new Error(`会话不存在: ${req.sessionId}`);
    }

    const runtime = this.sessions.get(req.sessionId);
    return {
      summary: this.toSummary(row),
      entries: loadSessionEntries(req.sessionId),
      run: {
        isRunning: runtime?.isStreaming ?? false,
        streamingMessage: runtime?.agent.state.streamingMessage,
      },
    };
  }

  /** 重命名会话。 */
  renameSession(req: RenameSessionRequest): void {
    agentSessionRepo.updateTitle(req.sessionId, req.title);
  }

  /**
   * 删除会话。
   * 池中的会话先 dispose（中断运行并等待本轮落库）再出池，最后才删库行；
   * 顺序颠倒会让运行中的会话后续落库撞上已删除的外键。
   */
  async deleteSession(req: DeleteSessionRequest): Promise<void> {
    const runtime = this.sessions.get(req.sessionId);
    if (runtime) {
      await runtime.dispose();
      this.sessions.delete(req.sessionId);
    }
    agentSessionRepo.delete(req.sessionId);
  }

  /**
   * 发送用户消息：补建会话行、取得（或建立）运行时、同步本次运行的设置后发起运行。
   * 立即返回，不等待运行结束；运行期的失败由内核转成事件发出。
   */
  async streamSend(req: StreamSendRequest): Promise<StreamSendResponse> {
    const thinkingLevel: ThinkingLevel = req.thinkingLevel ?? 'medium';
    // 首次组装会往会话日志写模型记录，会话行必须先存在
    this.ensureSessionRow(req.sessionId, req.text, req.images?.length ?? 0);

    // 首次组装就带上本次的思考级别，运行时建立后不必再补一次设置
    const session = this.getOrCreateRuntime(req.sessionId, thinkingLevel);
    if (session.isStreaming) {
      throw new Error('会话正在运行中，请等待本轮结束后再发送');
    }
    session.setThinkingLevel(thinkingLevel);
    // 系统提示按本次请求现算：换书后下一轮即刻生效，无书时段落为空、回落基础提示
    session.setSystemPrompt(await buildChatSystemPrompt(req.bookId));

    // prompt() 直到运行结束才 resolve，因此不 await：请求需要立即返回。
    // 启动失败时补一个 agent_end，让前端从等待态里退出。
    session.prompt(req.text, { images: req.images }).catch((error: unknown) => {
      console.error('[SessionService] 运行启动失败:', error);
      this.emitEvent(req.sessionId, { type: 'agent_end', messages: [] });
    });

    return { sessionId: req.sessionId };
  }

  /**
   * 中断会话正在进行的运行。
   * 会话不在池中（本就没有运行）时不做任何事，返回 success: false。
   */
  async streamAbort(req: StreamAbortRequest): Promise<StreamAbortResponse> {
    const session = this.sessions.get(req.sessionId);
    if (!session) {
      return { success: false };
    }
    await session.abort();
    return { success: true };
  }

  /** 把库中的会话行与运行时状态合成列表项。 */
  private toSummary(row: AgentSessionRow): SessionSummary {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isRunning: this.sessions.get(row.id)?.isStreaming ?? false,
    };
  }

  /** 首次发送消息时补建会话行，标题由首条消息截取；首条消息只有图片时用占位标题。 */
  private ensureSessionRow(sessionId: string, text: string, imageCount: number): void {
    if (agentSessionRepo.findById(sessionId)) {
      return;
    }
    const title = titleFromText(text) || (imageCount > 0 ? '[图片]' : '');
    agentSessionRepo.create({ id: sessionId, title });
  }

  /** 取得会话运行时；首次访问时按要求的思考级别组装，并订阅事件转发给渲染层。 */
  private getOrCreateRuntime(sessionId: string, thinkingLevel: ThinkingLevel): AgentSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createAgentSession({
        sessionId,
        definition: readingAgent,
        modelRuntime: this.modelRuntime,
        thinkingLevel,
      });
      session.subscribe(event => this.emitEvent(sessionId, event));
      this.sessions.set(sessionId, session);
    }
    return session;
  }
}

export const sessionService = new SessionService();
