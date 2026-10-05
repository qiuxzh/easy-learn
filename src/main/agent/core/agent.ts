import type {
  AgentEvent,
  AgentMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingLevel,
} from '@shared/types/chat';
import { Model, Tool } from '../model/types';
import {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentLoopConfig,
  AgentLoopTurnUpdate,
  BeforeToolCallContext,
  BeforeToolCallResult,
  PrepareNextTurnContext,
  QueueMode,
  ShouldStopAfterTurnContext,
} from './types';
import type { StreamFn } from '../model/stream-fn';
import { Static, TSchema } from 'typebox';
import { runAgentLoop, runAgentLoopContinue } from './agent-loop';
import { getDefaultStreamFn } from './stream-fn';

/** 工具执行产生的结果。 */
export interface AgentToolResult<T> {
  /** 返回给模型的文本或图像内容。 */
  content: (TextContent | ImageContent)[];
  /** 用于日志或 UI 渲染的任意结构化详情。 */
  details: T;
  /** 由此结果引入、且自此记录点起可用的工具名称。 */
  addedToolNames?: string[];
  /**
   * 提示 Agent 应在当前工具批次后停止。
   * 仅当批次中每个已定稿的工具结果都将其设置为 true 时，才会提前终止。
   */
  terminate?: boolean;
}

/**
 * 单个助手消息中工具调用的执行方式配置。
 *
 * - "sequential"：每个工具调用在上一个开始之前完成准备、执行和收尾。
 * - "parallel"：工具调用按顺序准备，然后允许并发的工具同时执行。
 *   每个工具收尾后按工具完成顺序发出 `tool_execution_end`，
 *   而工具结果消息产物则稍后按助手消息中的原始顺序发出。
 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/** Agent 运行时使用的工具定义。 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends Tool<TParameters> {
  /** 用于 UI 显示的可读标签。 */
  label: string;
  /** 执行工具调用。失败时抛出异常，而不要将错误编码进 `content`。 */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<TDetails>>;

  executionMode?: ToolExecutionMode;
}

export const DEFAULT_MODEL = {
  id: 'unknown',
  name: 'unknown',
  api: 'unknown',
  provider: 'unknown',
  baseUrl: '',
  reasoning: false,
  input: [],
  contextWindow: 0,
  maxTokens: 0,
} satisfies Model<any>;

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    message =>
      message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
  );
}

/** 传入底层 Agent 循环的上下文快照。 */
export interface AgentContext {
  /** 随请求包含的系统提示。 */
  systemPrompt: string;
  /** 模型可见的记录。 */
  messages: AgentMessage[];
  /** 本次运行可用的工具。 */
  tools?: AgentTool<any>[];
}

/**
 * 公开的 Agent 状态。
 *
 * Q：为什么要有 AgentState，其字段直接作为Agent的属性不行吗？
 * A：可以。不过，Agent的属性一般是一开始定义一次，之后基本不动了。AgentState是经常变动的属性，和run相关
 */
export interface AgentState {
  /** 随每次模型请求发送的系统提示。 */
  systemPrompt: string;
  /** 用于后续 turn 的当前模型。 */
  model: Model<any>;
  /** 用于后续 turn 的请求推理级别。 */
  thinkingLevel: ThinkingLevel;
  /** 可用工具。赋新数组会复制顶层数组。不可变更新 */
  set tools(tools: AgentTool<any>[]);
  get tools(): AgentTool<any>[];
  /** 对话记录。赋新数组会复制顶层数组。不可变更新 */
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  /**
   * 当 Agent 正在处理提示或延续时为 true。
   *
   * 在 await 的 `agent_end` 监听器完成之前一直保持 true。
   */
  readonly isStreaming: boolean;
  /** 当前流式响应的部分助手消息（若有）。 */
  readonly streamingMessage?: AgentMessage;
  /** 当前正在执行的工具调用 ID。不可变更新 */
  readonly pendingToolCalls: ReadonlySet<string>;
  /** 最近一次失败或中止的助手 turn 的错误消息（若有）。 */
  readonly errorMessage?: string;
}

/**
 * Agent 内部维护的状态。和 AgentState 唯一区别在于把其只读状态改为可写。
 * 用处: Agent.state() 函数获取到的状态是只读的，防止信息内外部修改。
 */
type MutableAgentState = Omit<
  AgentState,
  'isStreaming' | 'streamingMessage' | 'pendingToolCalls' | 'errorMessage'
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

/**
 * 构造agent的state。
 * 1.初始化基本数据
 * 2.支持根据传入的initialState来初始化state
 * @param initialState
 */
function createMutableAgentState(
  initialState: Partial<
    Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
  > = {}
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? 'medium',
    systemPrompt: initialState?.systemPrompt ?? '',
    tools,
    messages,
    pendingToolCalls: new Set<string>(),
    isStreaming: false,
    streamingMessage: undefined,
    errorMessage: undefined,
  };
}

// 存储待处理的消息队列
class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === 'all') {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}

/**  创建agent的配置 {@link Agent} */
export interface AgentOptions {
  initialState?: Partial<
    Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
  >;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;

  // toolCall 前的钩子
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal
  ) => Promise<AfterToolCallResult | undefined>;
  // turn 结束后用于判断是否进行下一轮循环的钩子
  shouldStopAfterTurn?: (
    context: ShouldStopAfterTurnContext,
    signal?: AbortSignal
  ) => boolean | Promise<boolean>;

  /** 刷新上下文的函数
   * AgentLoopTurnUpdate包含可能会更新的东西
   */
  prepareNextTurnWithContext?: (
    context: PrepareNextTurnContext,
    signal?: AbortSignal
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  toolExecution?: ToolExecutionMode;
  streamFn: StreamFn;
}

export class Agent {
  private _state: MutableAgentState;
  private readonly listeners = new Set<
    // 给 listeners 加 AbortSignal，是为了在终止时让监听器也感知到被中止了，以方便让监听器提前停止防止不必要工作
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;
  // run 期间有值
  private activeRun?: ActiveRun;
  public toolExecution: ToolExecutionMode;
  public transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;
  // 定义消息转化为llm可用的格式的函数。由外部传入
  private convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  public shouldStopAfterTurn?: (
    context: ShouldStopAfterTurnContext,
    signal?: AbortSignal
  ) => boolean | Promise<boolean>;

  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ) => Promise<BeforeToolCallResult | undefined>;
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal
  ) => Promise<AfterToolCallResult | undefined>;
  public streamFunction: StreamFn;
  public prepareNextTurn?: (
    context: PrepareNextTurnContext,
    signal?: AbortSignal
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

  constructor(options: AgentOptions) {
    // 保证入参非空
    const runtimeOptions: Partial<AgentOptions> = options ?? {};
    this._state = createMutableAgentState(runtimeOptions.initialState);
    this.followUpQueue = new PendingMessageQueue('one-at-a-time');
    this.steeringQueue = new PendingMessageQueue('one-at-a-time');
    this.toolExecution = runtimeOptions.toolExecution ?? 'parallel';
    this.streamFunction = options.streamFn ?? getDefaultStreamFn();
    this.convertToLlm = options.convertToLlm ?? ((messages: AgentMessage[]) => messages);
    // hooks
    this.shouldStopAfterTurn = runtimeOptions.shouldStopAfterTurn;
    this.beforeToolCall = runtimeOptions.beforeToolCall;
    this.afterToolCall = runtimeOptions.afterToolCall;
  }

  /**
   * 订阅 Agent 运行期间的事件
   * 可设计为两个参数，一个是事件名，一个是回调。也可以把时间塞到回调函数的参数里面
   * @param listener
   */
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 返回只读类型的state
   */
  get state(): AgentState {
    return this._state;
  }

  /**
   * 设置思考级别，自下一次 run 起生效。
   * run 的配置在每次运行时读取一次（见 createLoopConfig），此后整个 run 的各 turn 沿用它，
   * 因此运行中修改只影响下一次运行。
   * 只改状态，不产生会话日志：变更记录由会话层负责。
   */
  setThinkingLevel(thinkingLevel: ThinkingLevel): void {
    this._state.thinkingLevel = thinkingLevel;
  }

  /**
   * 设置系统提示，自下一次 run 起生效。
   * 与思考级别同理：run 开始时读取一次（见 createContextSnapshot），运行中修改只影响下一次运行。
   * 系统提示不进会话日志，由调用方在每次运行前按运行上下文重新生成。
   */
  setSystemPrompt(systemPrompt: string): void {
    this._state.systemPrompt = systemPrompt;
  }

  /** Controls how queued steering messages are drained. */
  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  /** Controls how queued follow-up messages are drained. */
  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  /** Active abort signal for the current run, if any. */
  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  /** 中断当前运行；没有运行中的任务时什么都不做。 */
  abort(): void {
    this.activeRun?.abortController.abort();
  }

  /** Queue a message to be injected after the current assistant turn finishes. */
  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  /** Queue a message to run only after the agent would otherwise stop. */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  /** Remove all queued steering messages. */
  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  /** Remove all queued follow-up messages. */
  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  /** Remove all queued steering and follow-up messages. */
  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  /** Returns true when either queue still contains pending messages. */
  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  // 后续可以添加更多和steer和followUp相关的函数，例如删除特定一条消息

  /** 重置Agent的状态，包括清除队列和重置状态 */
  reset(): void {
    if (this.activeRun) {
      throw new Error('Agent is already processing. Wait for completion before resetting.');
    }
    this.clearAllQueues();
    this._state.messages = [];
    this._state.tools = [];
  }

  // 声明两个重载签名
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;

  async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[]
  ): Promise<void> {
    if (this.activeRun) {
      throw new Error(
        'Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.'
      );
    }
    const messages = normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
  }

  async continue(): Promise<void> {}

  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {}
  ): Promise<void> {
    await this.runWithLifecycle(async signal => {
      // runWithLifecycle 内部会创建abortController，signal逐层传递
      await runAgentLoop(
        messages, // 用户提示词
        this.createContextSnapshot(),
        this.createLoopConfig(options),
        (event: AgentEvent) => this.processEvents(event),
        signal,
        this.streamFunction
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async signal => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        this.createLoopConfig(),
        event => this.processEvents(event),
        signal,
        this.streamFunction
      );
    });
  }

  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }

  // 管理run之前、之后
  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent is already processing.');
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>(resolve => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;
    this._state.errorMessage = undefined;

    try {
      // 执行内部代码
      await executor(abortController.signal);
    } catch (error) {
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      // run 后续操作
      this.finishRun();
    }
  }

  // run 结束，处理状态信息
  private finishRun() {
    this._state.isStreaming = false;
    this._state.errorMessage = undefined;
    this._state.pendingToolCalls = new Set();
    this.activeRun?.resolve(); // promise结束
    this.activeRun = undefined;
  }

  // 出现意外的异常的处理。很极端才会异常
  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: this._state.model.api,
      provider: this._state.model.provider,
      model: this._state.model.id,
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } satisfies AgentMessage;
    // emit事件
    await this.processEvents({ type: 'message_start', message: failureMessage });
    await this.processEvents({ type: 'message_end', message: failureMessage });
    await this.processEvents({ type: 'turn_end', message: failureMessage, toolResults: [] });
    await this.processEvents({ type: 'agent_end', messages: [failureMessage] });
  }

  /**
   * 初始化每一次run时的配置信息
   * @param options
   * @private
   */
  private createLoopConfig(options = {}): AgentLoopConfig {
    return {
      afterToolCall: this.afterToolCall,
      beforeToolCall: this.beforeToolCall,
      convertToLlm: this.convertToLlm ?? defaultConvertToLlm,
      transformContext: this.transformContext,
      getFollowUpMessages: async () => this.followUpQueue.drain(),
      getSteeringMessages: async () => this.steeringQueue.drain(),
      prepareNextTurn: async (context: PrepareNextTurnContext) =>
        this.prepareNextTurn?.(context, this.signal),
      shouldStopAfterTurn: this.shouldStopAfterTurn,
      // 这保证了model和思考模式可变
      model: this._state.model,
      maxTokens: this._state.model.maxTokens, // 最大输出token
      // off 也照样交给适配器：它代表“明确要求不思考”，由适配器决定怎么表达
      reasoning: this._state.thinkingLevel,
    };
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  /**
   * 对 Agent 内部其他地方而言，其用于对外 emit 事件。
   * 内部职责：
   * 1.累积本次run的消息到 messages 数组里面
   * 2.更新对外暴露的pendingToolCalls和streamingMessage
   * @param event
   * @private
   */
  private async processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'message_start':
        this._state.streamingMessage = event.message;
        break;

      case 'message_update':
        this._state.streamingMessage = event.message;
        break;

      case 'message_end':
        this._state.streamingMessage = undefined;
        this._state.messages.push(event.message);
        break;

      case 'tool_execution_start': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'tool_execution_end': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'turn_end':
        if (event.message.role === 'assistant' && event.message.errorMessage) {
          this._state.errorMessage = event.message.errorMessage;
        }
        break;

      case 'agent_end':
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    // 每次 run 之前都会给signal赋值，而只有run期间本函数才会掉用。
    // 如果signal为undefined，说明Agent未运行，抛出错误。
    if (!signal) {
      throw new Error('Agent 未运行');
    }

    for (const listener of this.listeners) {
      // listener严格串行执行
      await listener(event, signal);
    }
  }
}

function normalizePromptInput(
  input: string | AgentMessage | AgentMessage[],
  images?: ImageContent[]
): AgentMessage[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input !== 'string') {
    return [input];
  }
  // 存储用户消息、图片消息；纯图片消息不写入空文本块
  const content: Array<TextContent | ImageContent> = [];
  if (input) {
    content.push({ type: 'text', text: input });
  }
  if (images && images.length > 0) {
    content.push(...images);
  }
  return [{ role: 'user', content, timestamp: Date.now() }];
}
