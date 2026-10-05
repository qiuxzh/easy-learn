import type { AgentMessage, AssistantMessageEvent, ChatEventPayload } from '@shared/types/chat';
import { useSessionStore } from '@/stores/session-store';
import type { RunOutcome } from '@/stores/session-store';
import { userMessageToAppMessage } from '@/utils/message-util';

/**
 * chatStreamController：会话推送事件的唯一入口。
 *
 * 职责单一——把主进程推来的内核事件翻译成 sessionStore 的动作调用。
 * 自身不持有状态、不感知增量节流；发起请求的方向见 chatRequests。
 */

let initialized = false;

/** 把工具执行结果压平成一段文本。 */
function toolResultToText(result: unknown): string {
  if (typeof result === 'string') return result;

  const content = (result as { content?: unknown } | null)?.content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: 'text'; text: string } => {
        return (
          typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
        );
      })
      .map(part => part.text)
      .join('');
  }

  return JSON.stringify(result ?? null);
}

/** 从 agent_end 携带的消息列表推断本次运行的结局。 */
function readRunOutcome(messages: AgentMessage[]): RunOutcome {
  const last = messages[messages.length - 1];
  // 一条消息都没有，说明运行在产出消息之前就失败了
  if (!last) return { type: 'error', errorText: '运行未能启动' };
  if (last.role !== 'assistant') return { type: 'done' };
  if (last.stopReason === 'aborted') return { type: 'abort' };
  if (last.stopReason === 'error') {
    return { type: 'error', errorText: last.errorMessage ?? '请求出错' };
  }
  return { type: 'done' };
}

/** 保证联合类型的 switch 覆盖全部成员。 */
function assertNever(value: never): never {
  throw new Error(`未处理的会话事件：${JSON.stringify(value)}`);
}

/** 处理助手消息的流式事件。 */
function handleAssistantMessageEvent(sessionId: string, event: AssistantMessageEvent): void {
  const sessionStore = useSessionStore.getState();

  switch (event.type) {
    case 'text_start':
      sessionStore.appendStreamingPart(sessionId, 'text');
      return;
    case 'text_delta':
      sessionStore.appendPartDelta(sessionId, 'text', event.delta);
      return;
    case 'text_end':
      return;
    case 'thinking_start':
      sessionStore.appendStreamingPart(sessionId, 'reasoning');
      return;
    case 'thinking_delta':
      sessionStore.appendPartDelta(sessionId, 'reasoning', event.delta);
      return;
    case 'thinking_end':
      return;
    case 'toolcall_start':
    case 'toolcall_delta':
      // 工具入参的流式增量暂不渲染，等 toolcall_end 一次性落成 tool-call part
      return;
    case 'toolcall_end':
      sessionStore.appendToolCall(sessionId, {
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: JSON.stringify(event.toolCall.arguments ?? {}),
      });
      return;
    case 'done':
    case 'start':
    case 'error':
      // 内核在 agent-loop 内已吞掉这些事件
      return;
    default:
      return assertNever(event);
  }
}

/** 会话事件的唯一入口。 */
function handleSessionEvent({ sessionId, event }: ChatEventPayload): void {
  const sessionStore = useSessionStore.getState();

  switch (event.type) {
    case 'agent_start':
      sessionStore.setStreaming(sessionId, true);
      return;
    case 'agent_end':
      sessionStore.endRun(sessionId, readRunOutcome(event.messages));
      return;
    case 'turn_end':
      sessionStore.finishStep(sessionId);
      return;
    case 'message_start':
      // 助手消息只建空壳，内容由后续 message_update 增量填充；
      // 用户消息一次成型（发送的提示词、注入的 steering / follow-up 都会走到这里）
      if (event.message.role === 'assistant') {
        sessionStore.appendAssistantMessage(sessionId);
      } else if (event.message.role === 'user') {
        sessionStore.appendUserMessage(sessionId, userMessageToAppMessage(event.message));
      }
      return;
    case 'message_update':
      handleAssistantMessageEvent(sessionId, event.assistantMessageEvent);
      return;
    case 'message_end':
      // 助手消息定稿时才会拿到 token 用量，一次 turn 记一次
      if (event.message.role === 'assistant' && event.message.usage) {
        sessionStore.setLastAssistantUsage(sessionId, event.message.usage);
      }
      return;
    case 'tool_execution_end':
      sessionStore.appendToolResult(sessionId, {
        toolCallId: event.toolCallId,
        // input 已落在对应的 tool-call part 上，这里留空避免重复
        toolName: event.toolName,
        input: '',
        output: toolResultToText(event.result),
        success: !event.isError,
      });
      return;
    case 'compaction_start':
      sessionStore.beginCompactionNotice(sessionId);
      return;
    case 'compaction_end': {
      if (event.aborted) {
        sessionStore.endCompactionNotice(sessionId, { type: 'aborted' });
        return;
      }
      // result 存在表示压缩成功；否则是失败，errorMessage 由主进程填好
      if (event.result) {
        sessionStore.endCompactionNotice(sessionId, { type: 'done' });
      } else {
        sessionStore.endCompactionNotice(sessionId, {
          type: 'error',
          errorText: event.errorMessage ?? '压缩失败',
        });
      }
      return;
    }
    case 'turn_start':
    case 'tool_execution_start':
    case 'queue_update':
      return;
    default:
      return assertNever(event);
  }
}

/** 订阅后端推送的会话事件。应用启动时调用一次，重复调用只生效一次。 */
export function ensureChatStreamControllerInitialized(): void {
  if (initialized) return;
  initialized = true;

  window.api.onChatEvent(handleSessionEvent);
}
