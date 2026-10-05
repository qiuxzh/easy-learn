import type {
  AgentMessage,
  AgentToolCall,
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingLevel,
  ToolResultMessage,
} from '@shared/types/chat';
import { Model, StreamOptions } from '../model/types';
import { AgentContext, AgentToolResult, ToolExecutionMode } from './agent';

/**
 * 控制当 Agent 循环到达队列排空点时会注入多少条排队中的用户消息。
 *
 * - "all"：在该点排空并注入所有排队消息。
 * - "one-at-a-time"：仅排空并注入最旧的一条排队消息，其余消息留给后续的排空点。
 */
export type QueueMode = 'all' | 'one-at-a-time';

/** 传递给 `beforeToolCall` 的上下文。 */
export interface BeforeToolCallContext {
  /** 请求此工具调用的助手消息。 */
  assistantMessage: AssistantMessage;
  /** 来自 `assistantMessage.content` 的原始工具调用块。 */
  toolCall: AgentToolCall;
  /** 针对目标工具模式校验后的工具参数。 */
  args: unknown;
  /** 工具调用准备时的当前 Agent 上下文。 */
  context: AgentContext;
}

/** 传递给 `afterToolCall` 的上下文。 */
export interface AfterToolCallContext {
  /** 请求此工具调用的助手消息。 */
  assistantMessage: AssistantMessage;
  /** 来自 `assistantMessage.content` 的原始工具调用块。 */
  toolCall: AgentToolCall;
  /** 针对目标工具模式校验后的工具参数。 */
  args: unknown;
  /** 在应用任何 `afterToolCall` 覆盖之前已执行的工具结果。 */
  result: AgentToolResult<any>;
  /** 已执行工具结果当前是否被视为错误。 */
  isError: boolean;
  /** 工具调用定稿时的当前 Agent 上下文。 */
  context: AgentContext;
}

/** 传递给 `shouldStopAfterTurn` 的上下文。 */
export interface ShouldStopAfterTurnContext {
  /** 完成该 turn 的助手消息。 */
  message: AssistantMessage;
  /** 传递给前一个 `turn_end` 事件的工具结果消息。 */
  toolResults: ToolResultMessage[];
  /** 该 turn 的助手消息和工具结果追加后的当前 Agent 上下文。 */
  context: AgentContext;
  /** 若在此点退出，本次循环调用将返回的消息。Prompt 运行包含初始提示消息；延续运行不包含既有的上下文消息。 */
  newMessages: AgentMessage[];
}

/** 在发起下一次 provider 请求前，Agent 循环使用的替换运行时状态。 */
export interface AgentLoopTurnUpdate {
  /** 下一次 provider 请求使用的上下文。 */
  context?: AgentContext;
  /** 下一次 provider 请求使用的模型。 */
  model?: Model<any>;
  /** 下一次 provider 请求使用的思考级别。 */
  thinkingLevel?: ThinkingLevel;
}

/**
 * 从 `beforeToolCall` 返回的结果。
 *
 * 返回 `{ block: true }` 可阻止工具执行。循环会改为发出一个错误工具结果。
 * `reason` 将成为该错误结果中显示的文本。若省略，则使用默认的阻止消息。
 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  /**
   * 提示当此调用被阻止时 Agent 应在当前工具批次后停止。
   * 仅当批次中每个已定稿的工具结果都将其设置为 true 时，才会提前终止。
   */
  terminate?: boolean;
}

/**
 * 从 `afterToolCall` 返回的部分覆盖。
 *
 * 合并语义为逐字段：
 * - `content`：若提供，则整体替换工具结果的内容数组
 * - `details`：若提供，则整体替换工具结果的详情值
 * - `isError`：若提供，则替换工具结果的错误标记
 * - `terminate`：若提供，则替换提前终止提示
 *
 * 省略的字段保留原始已执行工具结果的值。
 * `content` 或 `details` 不做深层合并。
 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  /**
   * 提示 Agent 应在当前工具批次后停止。
   * 仅当批次中每个已定稿的工具结果都将其设置为 true 时，才会提前终止。
   */
  terminate?: boolean;
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}

/**
 * 每一次 run 的配置。在 run 之前被装载好
 * 包含 钩子函数、大模型配置(如 reasoning_level、max_tokens等)
 */
export interface AgentLoopConfig extends StreamOptions {
  model: Model<any>;

  /**
   * 在每次 LLM 调用前将 AgentMessage[] 转换为 LLM 兼容的 Message[]。
   *
   * 每个 AgentMessage 必须转换为 LLM 能理解的 UserMessage、AssistantMessage 或
   * ToolResultMessage。无法转换的 AgentMessage（例如仅用于 UI 的通知、状态消息）
   * 应被过滤掉。
   *
   * 约定：不得抛出异常或返回被拒绝的 Promise。改为返回一个安全的后备值。
   * 抛出异常会中断底层 Agent 循环，且不会产生正常的事件序列。
   *
   * @example
   * ```typescript
   * convertToLlm: (messages) => messages.flatMap(m => {
   *   if (m.role === "custom") {
   *     // 将自定义消息转换为用户消息
   *     return [{ role: "user", content: m.content, timestamp: m.timestamp }];
   *   }
   *   if (m.role === "notification") {
   *     // 过滤掉仅用于 UI 的消息
   *     return [];
   *   }
   *   // 透传标准的 LLM 消息
   *   return [m];
   * })
   * ```
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * 在 `convertToLlm` 之前应用到上下文上的可选变换。
   *
   * 用于在 AgentMessage 层面进行的操作：
   * - 上下文窗口管理（修剪旧消息）
   * - 从外部来源注入上下文（如记忆、知识库）
   *
   * 约定：不得抛出异常或返回被拒绝的 Promise。改为返回原始消息或另一个
   * 安全的后备值。
   *
   * @example
   * ```typescript
   * transformContext: async (messages) => {
   *   if (estimateTokens(messages) > MAX_TOKENS) {
   *     return pruneOldMessages(messages);
   *   }
   *   return messages;
   * }
   * ```
   */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  /**
   * 在每个 turn 完全结束且已发出 `turn_end` 后调用。
   *
   * 若返回 true，循环会在轮询 steering 或 follow-up 队列之前发出 `agent_end`
   * 并退出，不再发起另一次 LLM 调用。当前的助手响应及任何工具执行都会正常完成。
   * 此回调能看到已完成的 turn 上下文，并在 `prepareNextTurn` 之前运行。
   *
   * 用于在当前位置请求优雅停止，例如在上下文变得过满之前。
   *
   * 约定：不得抛出异常或返回被拒绝的 Promise。抛出异常会中断底层 Agent 循环，
   * 且不会产生正常的事件序列。
   */
  shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;

  /**
   * 在 `turn_end` 之后、循环将要继续且下一个 turn 开始之前调用。
   * 返回替换的 context/model/thinking 状态以影响下一个 turn。
   * 返回 undefined 则继续使用当前的上下文/配置。
   */
  prepareNextTurn?: (
    context: PrepareNextTurnContext
  ) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

  /**
   * 返回要在运行中途注入对话的 steering 消息。
   *
   * 在当前助手 turn 完成其工具调用后调用，除非 `shouldStopAfterTurn` 先行退出。
   * 若返回消息，它们会在下一次 LLM 调用前被添加到上下文中。
   * 当前助手消息中的工具调用不会被跳过。
   *
   * 用于在 Agent 工作过程中对其"引导"（steering）。
   *
   * 约定：不得抛出异常或返回被拒绝的 Promise。无 steering 消息可用时返回 []。
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * 返回在 Agent 本会停止之后需要处理的 follow-up 消息。
   *
   * 当 Agent 不再有工具调用且没有 steering 消息时调用。
   * 若返回消息，它们会被添加到上下文中，Agent 会以另一个 turn 继续。
   *
   * 用于应等到 Agent 完成之后再处理的后续消息。
   *
   * 约定：不得抛出异常或返回被拒绝的 Promise。无 follow-up 消息可用时返回 []。
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /**
   * 工具执行模式。
   * - "sequential"：逐个执行工具调用
   * - "parallel"：先按顺序预检工具调用，再并发执行允许的工具；
   *   每个工具定稿后按工具完成顺序发出 `tool_execution_end`，
   *   随后按助手消息中的原始顺序发出工具结果消息产物
   *
   * 默认值："parallel"
   */
  toolExecution?: ToolExecutionMode;

  /**
   * 在工具执行之前、参数校验之后调用。
   *
   * 返回 `{ block: true }` 可阻止执行。循环会改为发出一个错误工具结果。
   * 被阻止的结果也可以设置 `terminate: true` 以参与批次提前终止规则。
   * 该钩子会收到 Agent 的中止信号，并有责任遵循它。
   */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ) => Promise<BeforeToolCallResult | undefined>;

  /**
   * 在工具完成执行之后、发出 `tool_execution_end` 和工具结果消息事件之前调用。
   *
   * 返回 `AfterToolCallResult` 可覆盖已执行工具结果的部分内容：
   * - `content` 整体替换内容数组
   * - `details` 整体替换详情负载
   * - `isError` 替换错误标记
   * - `terminate` 替换提前终止提示
   *
   * 任何省略的字段都保留其原始值。不执行深层合并。
   * 该钩子会收到 Agent 的中止信号，并有责任遵循它。
   */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal
  ) => Promise<AfterToolCallResult | undefined>;
}
