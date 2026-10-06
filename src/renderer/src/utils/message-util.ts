import type {
  AppUIMessage,
  AppUIMessagePart,
  AppTextPart,
  AppReasoningPart,
  AppToolCallPart,
  AppToolResultPart,
  AppImagePart,
  AppAbortPart,
  AppErrorPart,
  AppCompactionPart,
} from '@/types/message';
import type {
  AssistantMessage,
  CompactionEntry,
  SessionEntry,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@shared/types/chat';

export function stringToAppMessage(text: string): AppUIMessage {
  const parts: AppUIMessagePart[] = [{ type: 'text', text }];
  return {
    id: '',
    role: 'user',
    parts,
  };
}

export function isTextPart(part: AppUIMessagePart | undefined | null): part is AppTextPart {
  return part !== undefined && part !== null && part.type === 'text';
}

export function isReasoningPart(
  part: AppUIMessagePart | undefined | null
): part is AppReasoningPart {
  return part !== undefined && part !== null && part.type === 'reasoning';
}

export function isToolCallPart(part: AppUIMessagePart | undefined | null): part is AppToolCallPart {
  return part !== undefined && part !== null && part.type === 'tool-call';
}

export function isToolResultPart(
  part: AppUIMessagePart | undefined | null
): part is AppToolResultPart {
  return part !== undefined && part !== null && part.type === 'tool-result';
}

export function isImagePart(part: AppUIMessagePart | undefined | null): part is AppImagePart {
  return part !== undefined && part !== null && part.type === 'image';
}

export function isAbortPart(part: AppUIMessagePart | undefined | null): part is AppAbortPart {
  return part !== undefined && part !== null && part.type === 'abort';
}

export function isErrorPart(part: AppUIMessagePart | undefined | null): part is AppErrorPart {
  return part !== undefined && part !== null && part.type === 'error';
}

export function isCompactionPart(
  part: AppUIMessagePart | undefined | null
): part is AppCompactionPart {
  return part !== undefined && part !== null && part.type === 'compaction';
}

/** 判断 part 是否为 text 或 reasoning 类型 */
export const isTextOrReasoningPart = (p: AppUIMessagePart): boolean =>
  p.type === 'text' || p.type === 'reasoning';

/** 判断 part 是否处于 streaming 状态 */
export const isStreamingPart = (p: AppUIMessagePart): boolean =>
  isTextOrReasoningPart(p) && (p as { state: string }).state === 'streaming';

/** 将所有 streaming 的 part 标记为 done */
export const markStreamingAsDone = (parts: AppUIMessagePart[]): void => {
  parts.forEach(p => {
    if (isStreamingPart(p)) {
      (p as { state: string }).state = 'done';
    }
  });
};

/** 将所有 streaming 的 part 标记为 abort */
export const markStreamingAsAbort = (parts: AppUIMessagePart[]): void => {
  parts.forEach(p => {
    if (isStreamingPart(p)) {
      (p as { state: string }).state = 'abort';
    }
  });
};

/** 获取消息列表中最后一条 assistant 消息 */
export const getLastAssistantMessage = (messages: AppUIMessage[]): AppUIMessage | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return null;
};

/** 获取消息列表中最后一条消息 */
export const getLastMessage = (messages: AppUIMessage[]): AppUIMessage | null => {
  if (messages.length === 0) return null;
  return messages[messages.length - 1];
};

/**
 * 向消息的指定类型 part 追加 delta 文本。
 * 一条消息内可以有多个同类型 part（如 text → 工具调用 → text），增量属于正在生成的那一块，
 * 因此从后往前找最后一个匹配项。
 */
export const appendTextDelta = (
  messages: AppUIMessage[],
  type: 'text' | 'reasoning',
  delta: string
): void => {
  const last = getLastMessage(messages);
  if (!last) return;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i];
    if (part.type !== type) continue;
    (part as { text: string }).text += delta;
    return;
  }
};

/* ───────────────────── 会话日志 → App 层消息 ───────────────────── */

/**
 * TODO(消息模型对齐)：内核消息与 App 层消息的映射规则尚未定稿。
 * 当前实现只求"能渲染历史"：用户/助手消息逐条转换，工具结果并入其前一条助手消息；
 * 图片只保留落盘路径，思考签名、stopReason 等信息一律丢弃。规则确定后重写本段。
 */

/**
 * 把一条内核用户消息转成 App 层消息。
 * 文本与图片按内核里的顺序落到 parts：图片只取路径，渲染时拼 app:// 地址。
 */
export function userMessageToAppMessage(message: UserMessage): AppUIMessage {
  const parts: AppUIMessagePart[] = [];

  if (typeof message.content === 'string') {
    parts.push({ type: 'text', text: message.content });
  } else {
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.path) {
        parts.push({ type: 'image', path: block.path });
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts,
  };
}

/** 把助手消息的 content 转换为 App 层 part 列表 */
function assistantContentToParts(message: AssistantMessage): AppUIMessagePart[] {
  return message.content.map(part => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: (part as TextContent).text,
        state: 'done',
      } satisfies AppTextPart;
    }
    if (part.type === 'thinking') {
      return {
        type: 'reasoning',
        text: (part as ThinkingContent).thinking,
        state: 'done',
      } satisfies AppReasoningPart;
    }
    const toolCall = part as ToolCall;
    return {
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: JSON.stringify(toolCall.arguments ?? {}),
    } satisfies AppToolCallPart;
  });
}

/** 把工具结果消息的 content 压平成一段文本 */
function toolResultToText(message: ToolResultMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === 'text')
    .map(part => part.text)
    .join('');
}

/**
 * 把一条压缩标记转成 App 层的系统提示（一条独立消息，位置就是它在日志里的位置）。
 * 摘要正文与用量都不渲染，所以不带进 App 层。
 */
function compactionEntryToAppMessage(entry: CompactionEntry): AppUIMessage {
  const part: AppCompactionPart = { type: 'compaction', state: 'done' };
  return { id: entry.id, role: 'system', parts: [part] };
}

/**
 * 把会话日志转换为 App 层消息列表。
 * 只有 message 类 entry 会产出对话内容；压缩标记产出一条系统提示；模型变更一律跳过。
 */
export function sessionEntriesToAppMessages(entries: SessionEntry[]): AppUIMessage[] {
  const messages: AppUIMessage[] = [];

  for (const entry of entries) {
    if (entry.type === 'compaction') {
      messages.push(compactionEntryToAppMessage(entry));
      continue;
    }
    if (entry.type !== 'message') continue;
    const { message } = entry;

    if (message.role === 'user') {
      messages.push(userMessageToAppMessage(message));
      continue;
    }

    if (message.role === 'assistant') {
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: assistantContentToParts(message),
        usage: message.usage,
      });
      continue;
    }

    // 工具结果挂到它前面那条助手消息上，与流式渲染的结构保持一致
    const last = messages[messages.length - 1];
    if (!last) continue;
    const resultPart: AppToolResultPart = {
      type: 'tool-result',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      input: '',
      output: toolResultToText(message),
      success: !message.isError,
      // 详情随消息一起落在会话日志里，回放历史会话时同样能拿到快照
      details: message.details,
    };
    last.parts.push(resultPart);
  }

  return messages;
}
