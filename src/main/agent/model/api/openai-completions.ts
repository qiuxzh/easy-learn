import OpenAI from 'openai';
import type { TSchema } from 'typebox';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionReasoningEffort,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';
import type { StreamFn } from '../stream-fn';
import type { ProviderAuth } from '../model-runtime';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  ProviderId,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
  ThinkingLevel,
} from '@shared/types/chat';
import type { Context, Model, StreamOptions, Tool } from '../types';
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from '../utils/event-stream';

/**
 * 按 provider 取授权信息的函数。由装配层注入，
 * 使 StreamFn 只依赖「授权怎么取」这个约定，而不依赖配置从哪来
 */
export type StreamAuthResolver = (provider: ProviderId) => ProviderAuth | undefined;

/** 部分兼容服务（DeepSeek 等）在 delta 上额外返回思考内容，官方类型未覆盖 */
type ReasoningDelta = ChatCompletionChunk.Choice.Delta & { reasoning_content?: string | null };

/** 回传历史时思考内容走同一个非官方字段，助手消息的参数类型同样需要放宽 */
type ReasoningAssistantMessageParam = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string;
};

/**
 * 创建 `openai-completions` 协议使用的流式函数。
 *
 * 该函数负责把 openai 的流式分片翻译成 Agent 内核约定的 {@link AssistantMessageEvent} 序列：
 * 不做任何网络之外的副作用，也不会抛出异常——鉴权失败、网络错误、被中止等情况
 * 一律编码成 `error` 事件，保证 `StreamFn` 的调用方只需消费事件流。
 */
export function createOpenAiCompletionsStreamFn(resolveAuth: StreamAuthResolver): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    // 事件流先返回给调用方，请求结果随后异步推入，调用方无需等待网络
    void pump(model, context, options, resolveAuth, stream);
    return stream;
  };
}

/** 生成一个全新的、内容为空的助手消息骨架 */
function createAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

/** 复制一份助手消息快照。事件里派发的是快照，避免消费方看到后续被改写的内容 */
function snapshot(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map(block => ({ ...block })),
    usage: message.usage ? { ...message.usage } : undefined,
  };
}

/** 把一个内容块追加到消息末尾，返回它的下标 */
function appendBlock(
  message: AssistantMessage,
  block: TextContent | ThinkingContent | ToolCall
): number {
  message.content.push(block);
  return message.content.length - 1;
}

/** 取指定下标处的文本块，类型不符或越界时返回 undefined */
function textBlockAt(
  message: AssistantMessage,
  index: number | undefined
): TextContent | undefined {
  if (index === undefined) return undefined;
  const block = message.content[index];
  return block?.type === 'text' ? block : undefined;
}

/** 取指定下标处的思考块，类型不符或越界时返回 undefined */
function thinkingBlockAt(
  message: AssistantMessage,
  index: number | undefined
): ThinkingContent | undefined {
  if (index === undefined) return undefined;
  const block = message.content[index];
  return block?.type === 'thinking' ? block : undefined;
}

/** 请求单次输出上限；模型配置与调用参数都未给出有效值时交给接口方决定 */
function pickMaxTokens(model: Model<Api>, options: StreamOptions | undefined): number | undefined {
  const value = options?.maxTokens ?? model.maxTokens;
  return value > 0 ? value : undefined;
}

/**
 * 模型未声明 thinkingLevelMap 时各档位的兜底取值，沿用接口自身的命名：
 * medium 与 max 同名直传，off 落到 none（即明确要求不思考）
 */
const DEFAULT_REASONING_EFFORT: Record<ThinkingLevel, ChatCompletionReasoningEffort> = {
  off: 'none',
  medium: 'medium',
  max: 'max',
};

/**
 * 把内核的思考级别解析成接口的 reasoning_effort 取值。
 * 未指定级别时返回 undefined，即完全不携带该参数，由接口用默认行为
 */
function toReasoningEffort(
  model: Model<Api>,
  options: StreamOptions | undefined
): ChatCompletionReasoningEffort | undefined {
  const level = options?.reasoning;
  if (!level) return undefined;
  // 配置里的取值可能不在 SDK 列举的联合类型内，但接口本身接受，故按约定原样透传
  const effort = model.thinkingLevelMap?.[level] ?? DEFAULT_REASONING_EFFORT[level];
  return effort as ChatCompletionReasoningEffort;
}

/**
 * 把 openai 的用量换算成本项目的用量。
 * 接口没给出的细分（如缓存命中）保持 undefined，由渲染层决定怎么呈现
 */
function toUsage(usage: NonNullable<ChatCompletionChunk['usage']>): Usage {
  return {
    input: usage.prompt_tokens,
    output: usage.completion_tokens,
    cacheRead: usage.prompt_tokens_details?.cached_tokens,
    reasoning: usage.completion_tokens_details?.reasoning_tokens,
    totalTokens: usage.total_tokens,
  };
}

/** 把 openai 的结束原因映射成内核的 StopReason */
function toStopReason(
  finishReason: ChatCompletionChunk.Choice['finish_reason'],
  hasToolCalls: boolean
): Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse' | 'error'> {
  switch (finishReason) {
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'toolUse';
    default:
      return hasToolCalls ? 'toolUse' : 'stop';
  }
}

/** 统一把任意抛出物转成可读字符串 */
function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 取出增量里的思考内容，兼容未在官方类型中声明的 reasoning_content */
function readReasoning(delta: ChatCompletionChunk.Choice.Delta): string | undefined {
  const value = (delta as ReasoningDelta).reasoning_content;
  return value ? value : undefined;
}

/** 解析累积到的工具参数。模型偶尔产出非法 JSON，此时交由参数校验环节报错 */
function parseArguments(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 驱动一次请求：创建流式请求、消费分片、把结果推入事件流。
 *
 * 事件流最终一定以 `done` 或 `error` 收尾，不会出现“流开了却没有终态”的情况
 */
async function pump(
  model: Model<Api>,
  context: Context,
  options: StreamOptions | undefined,
  resolveAuth: StreamAuthResolver,
  stream: AssistantMessageEventStream
): Promise<void> {
  const message = createAssistantMessage(model);
  const emit = (event: AssistantMessageEvent): void => stream.push(event);

  emit({ type: 'start', partial: snapshot(message) });

  let finishReason: ChatCompletionChunk.Choice['finish_reason'] = null;
  let usage: ChatCompletionChunk['usage'];
  let failure: { reason: 'error' | 'aborted'; message: string } | undefined;

  /**
   * openai 的流没有显式的块起止事件，只能靠 delta 的内容判断。
   * 这里记录当前正在追加的文本/思考块，块类型切换时先收尾上一个
   */
  let openBlock: { kind: 'text' | 'thinking'; index: number } | undefined;
  /** tool_calls 的 index → 该工具调用块在 message.content 中的下标 */
  const toolBlockIndexes = new Map<number, number>();
  /** tool_calls 的 index → 累积中的 arguments JSON 片段 */
  const toolArguments = new Map<number, string>();

  /** 结束当前正在追加的文本/思考块 */
  const closeOpenBlock = (): void => {
    if (!openBlock) return;
    if (openBlock.kind === 'text') {
      const block = textBlockAt(message, openBlock.index);
      if (block) {
        emit({
          type: 'text_end',
          contentIndex: openBlock.index,
          content: block.text,
          partial: snapshot(message),
        });
      }
    } else {
      const block = thinkingBlockAt(message, openBlock.index);
      if (block) {
        emit({
          type: 'thinking_end',
          contentIndex: openBlock.index,
          content: block.thinking,
          partial: snapshot(message),
        });
      }
    }
    openBlock = undefined;
  };

  /** 取当前类型的块下标，必要时新建一个并发出 start 事件 */
  const ensureBlock = (kind: 'text' | 'thinking'): number => {
    if (openBlock?.kind === kind) return openBlock.index;
    closeOpenBlock();
    const index =
      kind === 'text'
        ? appendBlock(message, { type: 'text', text: '' })
        : appendBlock(message, { type: 'thinking', thinking: '' });
    openBlock = { kind, index };
    emit(
      kind === 'text'
        ? { type: 'text_start', contentIndex: index, partial: snapshot(message) }
        : { type: 'thinking_start', contentIndex: index, partial: snapshot(message) }
    );
    return index;
  };

  try {
    const auth = resolveAuth(model.provider);
    if (!auth?.apiKey) {
      throw new Error(`provider "${model.provider}" 未配置 apiKey`);
    }

    const client = new OpenAI({ apiKey: auth.apiKey, baseURL: auth.baseUrl });
    const response = await client.chat.completions.create(
      {
        model: model.id,
        messages: toOpenAiMessages(context, model.input.includes('image')),
        tools: toOpenAiTools(context.tools),
        tool_choice: options?.toolChoice,
        temperature: options?.temperature,
        max_tokens: pickMaxTokens(model, options),
        reasoning_effort: toReasoningEffort(model, options),
        stream: true,
        // 不显式要求时，接口不会在流末尾补一帧用量
        stream_options: { include_usage: true },
      },
      { signal: options?.signal }
    );

    for await (const chunk of response) {
      // 用量单独成帧，这一帧的 choices 为空，必须在取 choice 之前收下
      if (chunk.usage) usage = chunk.usage;

      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;

      if (delta.content) {
        const index = ensureBlock('text');
        const block = textBlockAt(message, index);
        if (block) {
          block.text += delta.content;
          emit({
            type: 'text_delta',
            contentIndex: index,
            delta: delta.content,
            partial: snapshot(message),
          });
        }
      }

      const reasoning = readReasoning(delta);
      if (reasoning) {
        const index = ensureBlock('thinking');
        const block = thinkingBlockAt(message, index);
        if (block) {
          block.thinking += reasoning;
          emit({
            type: 'thinking_delta',
            contentIndex: index,
            delta: reasoning,
            partial: snapshot(message),
          });
        }
      }

      if (delta.tool_calls?.length) {
        // 文本/思考到此为止，工具调用不会和它们共用一个块
        closeOpenBlock();
        for (const toolCall of delta.tool_calls) {
          applyToolCallDelta(toolCall, message, toolBlockIndexes, toolArguments, emit);
        }
      }
    }
  } catch (error) {
    failure = {
      reason: options?.signal?.aborted ? 'aborted' : 'error',
      message: stringifyError(error),
    };
  }

  closeOpenBlock();

  // 流结束即工具调用定稿：把累积的参数解析进块里，并补发 end 事件
  for (const [toolIndex, contentIndex] of toolBlockIndexes) {
    const block = message.content[contentIndex];
    if (block?.type !== 'toolCall') continue;
    block.arguments = parseArguments(toolArguments.get(toolIndex) ?? '');
    emit({ type: 'toolcall_end', contentIndex, toolCall: block, partial: snapshot(message) });
  }

  if (usage) {
    message.usage = toUsage(usage);
  }
  message.rawStopReason = finishReason ?? undefined;

  const hasToolCalls = message.content.some(block => block.type === 'toolCall');
  const stopReason = failure?.reason ?? toStopReason(finishReason, hasToolCalls);
  message.stopReason = stopReason;

  if (stopReason === 'error' || stopReason === 'aborted') {
    message.errorMessage = failure?.message ?? '模型请求失败';
    emit({ type: 'error', reason: stopReason, error: snapshot(message) });
    return;
  }

  emit({ type: 'done', reason: stopReason, message: snapshot(message) });
}

/**
 * 把一帧工具调用增量应用到消息上。
 *
 * openai 按 `index` 分组同一次工具调用：`id` 与 `name` 通常只出现在首帧，
 * `arguments` 则是逐帧追加的 JSON 片段，需要先拼起来、等流结束再解析
 */
function applyToolCallDelta(
  delta: ChatCompletionChunk.Choice.Delta.ToolCall,
  message: AssistantMessage,
  toolBlockIndexes: Map<number, number>,
  toolArguments: Map<number, string>,
  emit: (event: AssistantMessageEvent) => void
): void {
  let index = toolBlockIndexes.get(delta.index);
  if (index === undefined) {
    index = appendBlock(message, {
      type: 'toolCall',
      id: delta.id ?? '',
      name: delta.function?.name ?? '',
      arguments: {},
    });
    toolBlockIndexes.set(delta.index, index);
    emit({ type: 'toolcall_start', contentIndex: index, partial: snapshot(message) });
  }

  const block = message.content[index];
  if (block?.type !== 'toolCall') return;

  if (delta.id) block.id = delta.id;
  if (delta.function?.name) block.name = delta.function.name;

  const fragment = delta.function?.arguments;
  if (fragment) {
    toolArguments.set(delta.index, (toolArguments.get(delta.index) ?? '') + fragment);
    emit({
      type: 'toolcall_delta',
      contentIndex: index,
      delta: fragment,
      partial: snapshot(message),
    });
  }
}

/** 把完整上下文翻译成 openai 的消息列表，系统提示词固定放在最前 */
function toOpenAiMessages(context: Context, supportsImage: boolean): ChatCompletionMessageParam[] {
  const converted: ChatCompletionMessageParam[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    converted.push({ role: 'system', content: systemPrompt });
  }
  // 工具角色只接受纯文本，图片先攒起来，等这批工具结果发完再补一条 user 消息
  let attachedImages: { text: string; url: string }[] = [];

  const flushAttachedImages = (): void => {
    if (attachedImages.length === 0) return;
    converted.push(toAttachedImagesMessage(attachedImages));
    attachedImages = [];
  };

  for (const message of context.messages) {
    // 一批工具结果必须连续跟在发起调用的助手消息之后，中间不能插入其它角色
    if (message.role !== 'toolResult') flushAttachedImages();

    switch (message.role) {
      case 'user':
        converted.push(toOpenAiUserMessage(message));
        break;
      case 'assistant': {
        const assistantMessage = toOpenAiAssistantMessage(message);
        if (assistantMessage) converted.push(assistantMessage);
        break;
      }
      case 'toolResult':
        converted.push(toOpenAiToolMessage(message));
        if (supportsImage) attachedImages.push(...collectToolImages(message));
        break;
    }
  }

  flushAttachedImages();
  return converted;
}

/** 用户消息：字符串直接透传，内容块列表转成文本/图片部分 */
function toOpenAiUserMessage(message: UserMessage): ChatCompletionUserMessageParam {
  if (typeof message.content === 'string') {
    return { role: 'user', content: message.content };
  }
  const content: ChatCompletionContentPart[] = message.content.map(part =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: toDataUrl(part.mimeType, requireImageData(part)) } }
  );
  return { role: 'user', content };
}

/**
 * 助手消息：保留文本、思考与工具调用。
 *
 * 思考内容按接口自己的字段名回传——能返回思考的兼容服务（DeepSeek 等）
 * 也要求把它带回上下文，否则多轮对话里的推理会断片。
 * 文本与思考都没有、又没有工具调用的助手消息整体跳过
 */
function toOpenAiAssistantMessage(
  message: AssistantMessage
): ReasoningAssistantMessageParam | undefined {
  const textParts = message.content.filter((block): block is TextContent => block.type === 'text');
  const toolCalls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
  const thinking = message.content
    .filter((block): block is ThinkingContent => block.type === 'thinking')
    .map(block => block.thinking)
    .join('\n')
    .trim();
  if (textParts.length === 0 && toolCalls.length === 0) return undefined;

  return {
    role: 'assistant',
    content:
      textParts.length === 0
        ? null
        : textParts.map(part => ({ type: 'text' as const, text: part.text })),
    ...(thinking && { reasoning_content: thinking }),
    ...(toolCalls.length > 0 && {
      tool_calls: toolCalls.map(call => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }),
  };
}

/** 工具结果消息：工具角色只接受纯文本，图片由 toAttachedImagesMessage 另起一条 user 消息 */
function toOpenAiToolMessage(message: ToolResultMessage): ChatCompletionToolMessageParam {
  const text = message.content
    .filter((part): part is TextContent => part.type === 'text')
    .map(part => part.text)
    .join('\n');
  const hasImages = message.content.some(part => part.type === 'image');
  // 工具角色不接受空内容：只有图片时给占位，完全没有输出时也说明一下
  const content = text.length > 0 ? text : hasImages ? '（见附带的图片）' : '（工具没有输出）';

  return { role: 'tool', tool_call_id: message.toolCallId, content };
}

/**
 * 取工具结果里的图片：每张配一段方括号标签与 data URL。
 * 标签带上工具名与路径，一是让模型知道这张图来自哪次工具调用，
 * 二是方括号标签明显不是用户说的话，避免模型把它当成用户的指令。
 */
function collectToolImages(message: ToolResultMessage): { text: string; url: string }[] {
  return message.content
    .filter((part): part is ImageContent => part.type === 'image')
    .map(part => ({
      text: `[${message.toolName} 返回的图片：${part.path}]`,
      url: toDataUrl(part.mimeType, requireImageData(part)),
    }));
}

/** 工具结果附带的图片：接口不接受工具角色带图，只能另起一条 user 消息跟在工具结果之后 */
function toAttachedImagesMessage(
  images: { text: string; url: string }[]
): ChatCompletionUserMessageParam {
  // 图文交替：标签紧挨着自己的那张图，一批里有多张图也能对上号
  return {
    role: 'user',
    content: images.flatMap(image => [
      { type: 'text' as const, text: image.text },
      { type: 'image_url' as const, image_url: { url: image.url } },
    ]),
  };
}

/** 把 base64 内容拼成接口要求的 data URL */
function toDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

/**
 * 取图片块的 base64 数据。
 * 图片以落盘路径入上下文，发请求前由读取环节填入 data；走到这里仍是引用形态即为内部错误。
 */
function requireImageData(part: ImageContent): string {
  if (!part.data) {
    throw new Error(`图片 ${part.path} 尚未读取为 base64`);
  }
  return part.data;
}

/** 把 typebox 的 schema 摊平成接口要求的普通 JSON Schema 对象 */
function toFunctionParameters(schema: TSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema));
}

/**
 * 把内核工具定义转成 openai 的工具集合。
 *
 * typebox 的 `Type.Object` 产出的就是 JSON Schema，可以直接作为 parameters 下发
 */
function toOpenAiTools(tools: Tool[] | undefined): ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toFunctionParameters(tool.parameters),
    },
  }));
}
