/**
 * 会话模块跨进程共享的类型：会话事件及其依赖的消息结构。
 *
 * 内核（src/main/agent）与渲染层共用这一份定义，主进程从本文件导入而不再自行声明，
 * 避免同一份结构出现两处定义。只放需要跨越 IPC 的数据结构；工具定义、模型装配、
 * 上下文装载等纯内核类型仍留在主进程。
 */

import { CompactionResult } from '@main/agent/common-agent/compaction/compaction';

/** 内置的模型 API 种类。 */
export type KnownApi =
  | 'openai-completions'
  | 'mistral-conversations'
  | 'openai-responses'
  | 'azure-openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'bedrock-converse-stream'
  | 'google-generative-ai'
  | 'google-vertex'
  | 'pi-messages';

/** 内置的模型服务商。 */
export type KnownProvider =
  | 'amazon-bedrock'
  | 'ant-ling'
  | 'anthropic'
  | 'google'
  | 'google-vertex'
  | 'openai'
  | 'azure-openai-responses'
  | 'openai-codex'
  | 'radius'
  | 'nvidia'
  | 'deepseek'
  | 'github-copilot'
  | 'xai'
  | 'groq'
  | 'cerebras'
  | 'openrouter'
  | 'vercel-ai-gateway'
  | 'zai'
  | 'zai-coding-cn'
  | 'mistral'
  | 'minimax'
  | 'minimax-cn'
  | 'moonshotai'
  | 'moonshotai-cn'
  | 'huggingface'
  | 'fireworks'
  | 'together'
  | 'baseten'
  | 'opencode'
  | 'opencode-go'
  | 'kimi-coding'
  | 'cloudflare-workers-ai'
  | 'cloudflare-ai-gateway'
  | 'qwen-token-plan'
  | 'qwen-token-plan-cn'
  | 'qwen-token-plan-individual'
  | 'xiaomi'
  | 'xiaomi-token-plan-cn'
  | 'xiaomi-token-plan-ams'
  | 'xiaomi-token-plan-sgp';

export type ProviderId = KnownProvider | string;

export type Api = KnownApi | (string & {});

export interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string; // e.g., for OpenAI responses, message metadata (legacy id string or TextSignatureV1 JSON)
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string; // Provider-specific opaque or serialized reasoning replay data
  /** When true, the thinking content was redacted by safety filters. The opaque
   *  encrypted payload is stored in `thinkingSignature` so it can be passed back
   *  to the API for multi-turn continuity. */
  redacted?: boolean;
}

export interface ImageContent {
  type: 'image';
  /** 落盘图片相对 dataDir 的路径，如 images/<sessionId>/<uuid>.png。会话日志只保存该路径。 */
  path: string;
  mimeType: string; // e.g., "image/jpeg", "image/png"
  /** base64 图片数据。仅在发往模型前由读取环节按需填入，不进入会话日志。 */
  data?: string;
}

export interface ToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
  /** OpenAI Responses namespace for calls to dynamically loaded or namespaced tools. */
  namespace?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead?: number;
  /**
   * Reasoning/thinking tokens, when the provider reports them. This is a subset of
   * `output`: `output` already includes these tokens. Set to a number (possibly 0) by
   * providers that expose a reasoning breakdown; left undefined by providers that don't.
   */
  reasoning?: number;
  totalTokens: number;
}

/**
 * turn 结束的原因。前三条是 调用大模型本身可能会返回的
 * - "stop" : 正常结束，没请求工具
 * - "length" : 模型输出还没写完，就撞上了 maxTokens/上下文上限被掐断，消息不完整
 * - "toolUse" : 模型这一轮生成到一半停下，是因为它想调工具（输出里带 toolCall）
 * - "error" : provider 请求失败（网络、鉴权、超时、厂商报错等）。
 * - "aborted" : 请求被用户手动终止
 * - "deferred" : 模型这一轮并不是"完成"，而是"我挂起了，以后用这个句柄再取结果"。
 * - "pending" : 表示"还在流式生成，最终 reason 未知"
 */
export type StopReason =
  | 'pending'
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted'
  | 'deferred';

export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number; // Unix timestamp in milliseconds
}

export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  /** 本次请求的 token 用量。请求未结束或 provider 未上报时为 undefined。 */
  usage?: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  rawStopReason?: string;
  /**
   * Provider indication of whether the model explicitly ended its turn.
   * Preserved for debugging and does not currently affect agent control flow.
   */
  endTurn?: boolean;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface ToolResultMessage<TDetails = unknown> {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[]; // Supports text and images
  details?: TDetails;
  /**
   * Names from `Context.tools` that became available after this result.
   * Providers with native deferred tool loading use this as the load point;
   * other providers ignore it and use `Context.tools` normally.
   */
  addedToolNames?: string[];
  isError: boolean;
  timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * Event protocol for AssistantMessageEventStream.
 *
 * Streams should emit `start` before partial updates, then terminate with either:
 * - `done` carrying the final successful AssistantMessage, or
 * - `error` carrying the final AssistantMessage with stopReason "error" or "aborted"
 *   and errorMessage.
 * partial 表示是一个可能未完成的AssistantMessage
 * contentIndex 是内容块的下标，让消费方在同一条 assistant 消息的多个（且可能同类型的）块中精确定位"当前这个 delta 属于哪一块"
 */
export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: 'done';
      reason: Extract<StopReason, 'stop' | 'length' | 'toolUse' | 'deferred'>;
      message: AssistantMessage;
    }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'>; error: AssistantMessage };

export interface CustomAgentMessages {
  // 默认为空 - 应用通过声明合并进行扩展
}

/**
 * AgentMessage：LLM 消息 + 自定义消息的联合。
 * 该抽象允许应用在保持与基础 LLM 消息的类型安全和兼容性的同时，
 * 添加自定义消息类型。
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** 由助手消息发出的单个工具调用内容块。 */
export type AgentToolCall = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>;

/**
 * Agent 为 UI 更新发出的事件。
 *
 * `agent_end` 是某次运行发出的最后一个事件，但被 await 的 `Agent.subscribe()`
 * 针对该事件的监听器仍属于该次运行结算的一部分。只有这些监听器结束后
 * Agent 才会变为空闲。
 */
export type AgentEvent =
  // Agent 生命周期
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  // Turn 生命周期 - 一个 turn 指一次助手响应 + 任何工具调用/结果
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] }
  // 消息生命周期 - 为用户、助手和工具结果消息发出
  | { type: 'message_start'; message: AgentMessage }
  // 仅在流式响应期间为助手消息发出
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'message_end'; message: AgentMessage }
  // 工具执行生命周期
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any }
  // tool_execution_update
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      /** 工具执行结果，形状由各工具决定；消费方需自行收窄后再读。 */
      result: unknown;
      isError: boolean;
    };

/** 待注入的排队消息变化，供界面展示尚未被消费的 steer / follow-up 消息。 */
export interface QueueUpdateEvent {
  type: 'queue_update';
  steering: readonly string[];
  followUp: readonly string[];
}

/** 会话对外发出的事件：内核事件，以及会话自身的状态事件。 */
export type AgentSessionEvent =
  | AgentEvent
  | QueueUpdateEvent
  | { type: 'compaction_start'; reason: 'manual' | 'threshold' | 'overflow' }
  | {
      type: 'compaction_end';
      reason: 'manual' | 'threshold' | 'overflow';
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    };

/** 思考级别。 */
export type ThinkingLevel = 'off' | 'medium' | 'max';
// export type ThinkingLevel = "off"  | "low" | "medium" | "high" | "xhigh" | "max";

/* ───────────────────── 会话日志（持久化投影，跨进程共用） ───────────────────── */

/** 会话日志中一条 entry 的公共字段。 */
export interface SessionEntryBase {
  /** entry 种类判别字段，取值见 SessionEntry 的各成员。 */
  type: string;
  /** 稳定主键。compaction 的 firstKeptEntryId 指向此处，不随更新变化。 */
  id: string;
  /** 会话内单调递增序号，决定 entry 顺序。 */
  seq: number;
  /** 创建时间，Unix 毫秒。 */
  timestamp: number;
}

/** 一条 LLM 消息。进入 LLM 上下文。 */
export interface SessionMessageEntry extends SessionEntryBase {
  type: 'message';
  message: AgentMessage;
}

/** 模型变更。不进上下文，仅用于回放会话的运行期设置。 */
export interface ModelChangeEntry extends SessionEntryBase {
  type: 'model_change';
  provider: ProviderId;
  modelId: string;
}

/** 上下文压缩标记。不进上下文，但决定上下文的截断点。 */
export interface CompactionEntry extends SessionEntryBase {
  type: 'compaction';
  /** 压缩摘要，用于顶替被截断的历史消息。 */
  summary: string;
  /** 从此 entry（含）起的消息保留，之前的用 summary 顶替。指向 SessionMessageEntry.id。 */
  firstKeptEntryId: string;
  /** 压缩前的 token 数。 */
  tokensBefore: number;
  /** 生成摘要那次 LLM 调用的 token 用量。 */
  usage?: Usage;
}

/** 会话日志中的一条 entry。 */
export type SessionEntry = SessionMessageEntry | ModelChangeEntry | CompactionEntry;

/* ───────────────────────────── 会话 IPC 契约 ───────────────────────────── */

/** 会话列表项。 */
export interface SessionSummary {
  id: string;
  title: string;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
  /** 最近活跃时间，Unix 毫秒。列表按此倒序、并据此分组。 */
  updatedAt: number;
  /** 是否正在运行中。 */
  isRunning: boolean;
}

/** 会话运行态快照。 */
export interface SessionRunState {
  isRunning: boolean;
  /** 正在生成、尚未落库的那条助手消息；空闲时为 undefined。 */
  streamingMessage?: AgentMessage;
}

/** 打开会话请求。 */
export interface OpenSessionRequest {
  sessionId: string;
}

/** 打开会话响应：摘要、完整日志与运行态快照。 */
export interface OpenSessionResult {
  summary: SessionSummary;
  entries: SessionEntry[];
  run: SessionRunState;
}

/** 重命名会话请求。 */
export interface RenameSessionRequest {
  sessionId: string;
  title: string;
}

/** 删除会话请求。 */
export interface DeleteSessionRequest {
  sessionId: string;
}

/**
 * 图片入库请求。
 * 带 images 时落盘这些字节（粘贴来源），不带时由主进程弹文件框让用户选择。
 * 单条消息的图片数量上限由渲染层把关。
 */
export interface ImageStoreRequest {
  /** 目标会话 id，决定图片存放的子目录。 */
  sessionId: string;
  /** 待落盘的图片字节；省略时由主进程弹框选择图片。 */
  images?: { bytes: Uint8Array; mimeType: string }[];
}

/** 发送消息请求。 */
export interface StreamSendRequest {
  sessionId: string;
  text: string;
  /** 本次消息携带的图片引用；内容已落盘，只带路径，发往模型时再读取。 */
  images?: ImageContent[];
  /** 本次运行使用的思考级别。缺省视作 medium。 */
  thinkingLevel?: ThinkingLevel;
  /** 关联的书籍 id，供阅读场景下的提问使用。 */
  bookId?: string;
}

/** 发送消息响应。 */
export interface StreamSendResponse {
  sessionId: string;
}

/** 中止流式响应请求。 */
export interface StreamAbortRequest {
  sessionId: string;
}

/** 中止流式响应响应。 */
export interface StreamAbortResponse {
  success: boolean;
}

/** 后端推送给前端的会话事件。 */
export interface ChatEventPayload {
  sessionId: string;
  event: AgentSessionEvent;
}
