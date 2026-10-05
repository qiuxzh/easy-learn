import type { StreamFn } from '../../model/stream-fn';
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from '../../model/utils/event-stream';
import type {
  Api,
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@shared/types/chat';
import type { Context, Model } from '../../model/types';

/** 脚本消息里的占位标识；发起请求时会被替换成实际模型信息 */
const PLACEHOLDER = { api: 'faux', provider: 'faux', model: 'faux' } as const;

/** 自增序号，用于给未显式指定 id 的工具调用块编号 */
let toolCallSeed = 0;

/** 脚本里能出现的助手内容块 */
export type FauxContentBlock = TextContent | ThinkingContent | ToolCall;

/** 脚本项：静态消息，或依赖本次真实上下文的函数 */
export type FauxStep = AssistantMessage | ((context: Context) => AssistantMessage);

/** 假 StreamFn 的配置 */
export interface FauxStreamOptions {
  /** 每个 delta 的最大字符数；省略时整块内容作为单个 delta */
  chunkSize?: number;
}

/** 带上下文记录的假 StreamFn */
export interface FauxStreamFn extends StreamFn {
  /** 每次被调用时收到的上下文，按调用顺序排列 */
  readonly contexts: Context[];
}

/** 造一个文本内容块 */
export function fauxText(text: string): TextContent {
  return { type: 'text', text };
}

/** 造一个思考内容块 */
export function fauxThinking(thinking: string): ThinkingContent {
  return { type: 'thinking', thinking };
}

/** 造一个工具调用内容块；未指定 id 时自动编号 */
export function fauxToolCall(
  name: string,
  args: Record<string, any>,
  options: { id?: string } = {}
): ToolCall {
  toolCallSeed += 1;
  return { type: 'toolCall', id: options.id ?? `faux-call-${toolCallSeed}`, name, arguments: args };
}

/**
 * 造一条助手消息。
 * content 传字符串时视为单个文本块；stopReason 决定事件流以 done 还是 error 收尾
 */
export function fauxMessage(
  content: string | FauxContentBlock | FauxContentBlock[],
  options: { stopReason?: AssistantMessage['stopReason'] } = {}
): AssistantMessage {
  return {
    role: 'assistant',
    content:
      typeof content === 'string'
        ? [fauxText(content)]
        : Array.isArray(content)
          ? content
          : [content],
    api: PLACEHOLDER.api,
    provider: PLACEHOLDER.provider,
    model: PLACEHOLDER.model,
    stopReason: options.stopReason ?? 'stop',
    timestamp: Date.now(),
  };
}

/**
 * 造一个假 StreamFn：按顺序消耗脚本，把每条消息翻译成完整的事件流。
 * 脚本用尽后再被调用会产出一条 error 流
 */
export function createFauxStreamFn(
  script: FauxStep[],
  options: FauxStreamOptions = {}
): FauxStreamFn {
  const pendingSteps = [...script];
  const contexts: Context[] = [];

  const streamFn: StreamFn = (model, context) => {
    contexts.push(context);
    const step = pendingSteps.shift();
    const stream = createAssistantMessageEventStream();

    // 与真实实现一致：先把事件流交给调用方，内容随后异步推入
    queueMicrotask(() => {
      if (!step) {
        stream.push({
          type: 'error',
          reason: 'error',
          error: failedMessage(model, '假 streamFn 的脚本已用尽'),
        });
        return;
      }
      const scripted = typeof step === 'function' ? step(context) : step;
      pumpMessage(stream, bindModel(scripted, model), options.chunkSize);
    });

    return stream;
  };

  return Object.assign(streamFn, { contexts });
}

/** 复制一份助手消息快照：数组与每个内容块都是新对象，避免消费方看到后续改写 */
function snapshot(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map(block => ({ ...block })),
    usage: message.usage ? { ...message.usage } : undefined,
  };
}

/** 把脚本消息里的占位标识换成本次请求的真实模型信息 */
function bindModel(message: AssistantMessage, model: Model<Api>): AssistantMessage {
  return { ...message, api: model.api, provider: model.provider, model: model.id };
}

/** 造一条以 error 收尾的助手消息 */
function failedMessage(model: Model<Api>, text: string): AssistantMessage {
  return { ...bindModel(fauxMessage([], { stopReason: 'error' }), model), errorMessage: text };
}

/** 把文本切成若干片；文本为空时不产出任何分片 */
function splitChunks(text: string, chunkSize: number | undefined): string[] {
  if (!text) return [];
  if (!chunkSize || chunkSize <= 0) return [text];

  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += chunkSize) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks;
}

/**
 * 把一条助手消息拆成完整事件流逐个推入：
 * 每个内容块走一遍 `start → delta × n → end`，最后统一以 done 或 error 收尾
 */
function pumpMessage(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  chunkSize: number | undefined
): void {
  // 流式过程中的部分消息，content 逐块累积；终态由 message 本身决定
  const partial: AssistantMessage = { ...message, content: [], stopReason: 'pending' };
  stream.push({ type: 'start', partial: snapshot(partial) });

  message.content.forEach((block, contentIndex) => {
    if (block.type === 'thinking') {
      const target: ThinkingContent = { type: 'thinking', thinking: '' };
      partial.content.push(target);
      stream.push({ type: 'thinking_start', contentIndex, partial: snapshot(partial) });
      for (const chunk of splitChunks(block.thinking, chunkSize)) {
        target.thinking += chunk;
        stream.push({
          type: 'thinking_delta',
          contentIndex,
          delta: chunk,
          partial: snapshot(partial),
        });
      }
      stream.push({
        type: 'thinking_end',
        contentIndex,
        content: block.thinking,
        partial: snapshot(partial),
      });
      return;
    }

    if (block.type === 'text') {
      const target: TextContent = { type: 'text', text: '' };
      partial.content.push(target);
      stream.push({ type: 'text_start', contentIndex, partial: snapshot(partial) });
      for (const chunk of splitChunks(block.text, chunkSize)) {
        target.text += chunk;
        stream.push({ type: 'text_delta', contentIndex, delta: chunk, partial: snapshot(partial) });
      }
      stream.push({
        type: 'text_end',
        contentIndex,
        content: block.text,
        partial: snapshot(partial),
      });
      return;
    }

    const target: ToolCall = { type: 'toolCall', id: block.id, name: block.name, arguments: {} };
    partial.content.push(target);
    stream.push({ type: 'toolcall_start', contentIndex, partial: snapshot(partial) });
    for (const chunk of splitChunks(JSON.stringify(block.arguments), chunkSize)) {
      stream.push({
        type: 'toolcall_delta',
        contentIndex,
        delta: chunk,
        partial: snapshot(partial),
      });
    }
    target.arguments = block.arguments;
    stream.push({
      type: 'toolcall_end',
      contentIndex,
      toolCall: block,
      partial: snapshot(partial),
    });
  });

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: snapshot(message) });
    return;
  }

  if (message.stopReason === 'pending') {
    stream.push({
      type: 'error',
      reason: 'error',
      error: {
        ...snapshot(message),
        stopReason: 'error',
        errorMessage: '脚本消息的 stopReason 不能是 pending',
      },
    });
    return;
  }

  stream.push({ type: 'done', reason: message.stopReason, message: snapshot(message) });
}
