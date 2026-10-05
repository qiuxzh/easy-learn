import type { AppUIMessage } from '@/types/message';
import {
  isTextPart,
  isReasoningPart,
  isToolCallPart,
  isToolResultPart,
  isAbortPart,
  isErrorPart,
} from '@/utils/message-util';

/** 工具栏/呼吸距离/规划提示：本地 chat status 状态 */
export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

// 从 messageUtil 重新导出，保持接口兼容
export { isTextPart, isReasoningPart, isToolCallPart, isToolResultPart, isAbortPart, isErrorPart };

/**
 * 一条 trace：一条用户消息，以及它之后、下一条用户消息之前的全部内容。
 * nodes 里既有助手消息，也有夹在中间的系统提示（目前只有上下文压缩标记），按出现顺序排列。
 */
export type Trace = { userMsg: AppUIMessage; nodes: AppUIMessage[] };

/**
 * 把消息按 trace 分组。
 * trace 从一条用户消息开始，到下一条用户消息（或运行结束）为止。
 * 内核日志保证一次运行由用户消息开启，所以不会出现没有用户消息的 trace；
 * 万一遇到归属不明的助手消息，直接跳过，不造无主的 trace。
 *
 * 系统提示（压缩标记）就地插进当前 trace，保持时间顺序：
 * 压缩发生在两个 turn 之间，所以它出现在"上一轮回复之后、下一轮回复之前"；
 * run 开始前的压缩会写在触发它的那条用户消息之前，于是落在上一条 trace 的末尾——
 * 与实际发生的时间一致，历史回放与实时流式看到的顺序也一致。
 */
export function groupMessagesIntoTraces(messages: AppUIMessage[]): Trace[] {
  const traces: Trace[] = [];
  let current: Trace | null = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      current = { userMsg: msg, nodes: [] };
      traces.push(current);
    } else if (msg.role === 'assistant') {
      if (current) current.nodes.push(msg);
    } else if (current) {
      // system
      current.nodes.push(msg);
    }
  }
  return traces;
}

/** trace 内的助手消息（用量统计、复制正文都只看这些，系统提示不算）。 */
export function traceAssistantMessages(trace: Trace): AppUIMessage[] {
  return trace.nodes.filter(message => message.role === 'assistant');
}

/** 拼装 user 消息的所有 text part */
export function getUserText(message: AppUIMessage): string {
  return message.parts
    .filter(isTextPart)
    .map(p => p.text)
    .join('');
}

/** 拼装 trace 内所有 assistant 消息的 text part */
export function getAssistantText(messages: AppUIMessage[]): string {
  return messages
    .flatMap(msg => msg.parts)
    .filter(isTextPart)
    .map(p => p.text)
    .join('\n\n');
}

/** trace 内任一节点是否含可渲染内容（用于多 step 场景，避免新 step 触发整个 trace 隐藏） */
export function traceHasContent(trace: Trace): boolean {
  return trace.nodes.some(msg =>
    msg.parts.some(
      part =>
        isTextPart(part) ||
        isReasoningPart(part) ||
        isToolCallPart(part) ||
        isToolResultPart(part) ||
        isAbortPart(part) ||
        isErrorPart(part)
    )
  );
}

export function getLastUserMessageId(messages: AppUIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'user') return msg.id;
  }
  return null;
}
