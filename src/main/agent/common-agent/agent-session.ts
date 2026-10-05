import type {
  AgentEvent,
  AgentMessage,
  AgentSessionEvent,
  ImageContent,
  SessionEntry,
  TextContent,
  ThinkingLevel,
} from '@shared/types/chat';
import { Agent } from '../core/agent';
import { SessionManager } from './session-manager';
import {
  CompactionPreparation,
  CompactionResult,
  CompactionSettings,
  CompactionSummary,
  DEFAULT_COMPACTION_SETTINGS,
  compact,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from '@main/agent/common-agent/compaction/compaction';
import { Model } from '@main/agent/model/types';

/** 构造 AgentSession 所需的依赖与会话级配置。 */
interface AgentSessionOptions {
  /** 已经装配好的内核 Agent，由组装层（createAgentSession）产出。 */
  agent: Agent;
  /** 该会话的日志管理器，唯一实例。 */
  sessionManager: SessionManager;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
  images?: ImageContent[];
  /** 运行中如何排队：steer 在当前 turn 后注入，followUp 等本次运行结束。未指定则运行中拒绝。 */
  streamingBehavior?: 'steer' | 'followUp';
}

/** 取出用户消息中的文本，用于与排队记录比对。 */
function extractMessageText(message: AgentMessage): string {
  if (message.role !== 'user') {
    return '';
  }
  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is TextContent => part.type === 'text')
    .map(part => part.text)
    .join('');
}

/**
 * 会话运行时：把装配好的内核 Agent 与持久化日志绑在一起。
 * 只负责跑——订阅事件、落库、prompt/abort、维护运行期设置；
 * 模型选择、系统提示与工具集由组装层（createAgentSession）决定。
 * 一个 sessionId 同时只应存在一个实例，由外部池保证唯一。
 */
export class AgentSession {
  /** 内核 Agent，状态与消息记录从它读取。 */
  readonly agent: Agent;
  readonly sessionManager: SessionManager;

  /** 事件订阅者，由池 / IPC 层注册。 */
  private readonly listeners = new Set<(event: AgentSessionEvent) => Promise<void> | void>();
  /** 会话级运行标志：agent_start 置位，agent_end 且监听器结算完成后清除。 */
  private _isAgentRunActive = false;
  private _unsubscribeAgent: undefined | (() => void);

  /** 尚未注入的 steer 消息文本，仅用于界面展示。 */
  private _steeringMessages: string[] = [];
  /** 尚未注入的 follow-up 消息文本，仅用于界面展示。 */
  private _followUpMessages: string[] = [];
  private compactionAbortController: AbortController | undefined;

  constructor(options: AgentSessionOptions) {
    this.agent = options.agent;
    this.sessionManager = options.sessionManager;
    // 用箭头函数包一层：内核按普通函数调用监听器，方法引用会丢失 this
    this._unsubscribeAgent = this.agent.subscribe(event => this._handleAgentEvent(event));
    this._initNextTurnRefresh();
  }

  /**
   * 内核事件的唯一出口。
   * 各分支按事件类型划分，落库、运行标志、队列展示都在这里同步。
   */
  private async _handleAgentEvent(event: AgentEvent) {
    // Agent 生命周期
    if (event.type === 'agent_start') {
      this._isAgentRunActive = true;
      await this._emit(event);
    }
    if (event.type === 'agent_end') {
      await this._emit(event);
      // 监听器全部结算完成后才算空闲
      this._isAgentRunActive = false;
    }

    // Turn 生命周期：一个 turn 指一次助手响应及其工具调用/结果
    if (event.type === 'turn_start') {
      await this._emit(event);
    }
    if (event.type === 'turn_end') {
      await this._emit(event);
    }

    // 消息生命周期
    if (event.type === 'message_start') {
      // 排队消息被注入时会重新走一遍消息生命周期，此时把它从待展示列表移除
      if (event.message.role === 'user') {
        await this._consumeQueuedMessage(event.message);
      }
      await this._emit(event);
    }
    if (event.type === 'message_update') {
      // 助手消息的流式增量，不落库
      await this._emit(event);
    }
    if (event.type === 'message_end') {
      // 只有 LLM 消息落库
      const { message } = event;
      if (
        message.role === 'user' ||
        message.role === 'assistant' ||
        message.role === 'toolResult'
      ) {
        this.sessionManager.appendMessage(message);
      }
      await this._emit(event);
    }

    // 工具执行生命周期
    if (event.type === 'tool_execution_start') {
      await this._emit(event);
    }
    if (event.type === 'tool_execution_end') {
      await this._emit(event);
    }
  }

  /** 把事件依次交给订阅者，严格串行。 */
  private async _emit(event: AgentSessionEvent): Promise<void> {
    // console.log('AgentSessionEvent: ', event);
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  /** 广播排队消息的当前快照。 */
  private async _emitQueueUpdate(): Promise<void> {
    await this._emit({
      type: 'queue_update',
      steering: [...this._steeringMessages],
      followUp: [...this._followUpMessages],
    });
  }

  /** 排队消息被注入后，从待展示列表中移除对应的一条文本。 */
  private async _consumeQueuedMessage(message: AgentMessage): Promise<void> {
    const text = extractMessageText(message);
    const steeringIndex = this._steeringMessages.indexOf(text);
    if (steeringIndex >= 0) {
      this._steeringMessages.splice(steeringIndex, 1);
    } else {
      const followUpIndex = this._followUpMessages.indexOf(text);
      if (followUpIndex < 0) {
        return;
      }
      this._followUpMessages.splice(followUpIndex, 1);
    }
    await this._emitQueueUpdate();
  }

  /** 组装一条用户消息。 */
  private _buildUserMessage(text: string, images?: ImageContent[]): AgentMessage {
    const content: (TextContent | ImageContent)[] = [];
    // 纯图片消息不写入空文本块，部分接口会拒绝空内容块
    if (text) {
      content.push({ type: 'text', text });
    }
    if (images && images.length > 0) {
      content.push(...images);
    }
    return { role: 'user', content, timestamp: Date.now() };
  }

  /** 解除对内核 Agent 的事件订阅。 */
  private _disconnectFromAgent(): void {
    this._unsubscribeAgent?.();
    this._unsubscribeAgent = undefined;
  }

  /** 订阅会话事件，返回取消订阅的函数。 */
  subscribe(listener: (event: AgentSessionEvent) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 会话是否正在运行。 */
  get isStreaming(): boolean {
    return this._isAgentRunActive;
  }

  /** 会话是否空闲。 */
  get isIdle(): boolean {
    return !this._isAgentRunActive;
  }

  /** 当前对话记录。 */
  get messages(): AgentMessage[] {
    return this.agent.state.messages;
  }

  /** 当前会话 id。 */
  get sessionId(): string {
    return this.sessionManager.sessionId;
  }

  /** 会话日志，按 seq 升序。 */
  getEntries(): readonly SessionEntry[] {
    return this.sessionManager.getEntries();
  }

  /** 尚未注入的 steer 消息文本。 */
  getSteeringMessages(): readonly string[] {
    return this._steeringMessages;
  }

  /** 尚未注入的 follow-up 消息文本。 */
  getFollowUpMessages(): readonly string[] {
    return this._followUpMessages;
  }

  /**
   * 设置会话思考级别，自下一次运行起生效。
   * 只改内核状态：思考级别不属于会话配置，不落日志，由每次运行显式带上。
   */
  setThinkingLevel(thinkingLevel: ThinkingLevel): void {
    this.agent.setThinkingLevel(thinkingLevel);
  }

  /**
   * 设置系统提示，自下一次运行起生效。
   * 同样不落日志：提示词按每次运行的上下文（如当前关联的书籍）现算，调用方负责组装。
   */
  setSystemPrompt(systemPrompt: string): void {
    this.agent.setSystemPrompt(systemPrompt);
  }

  /**
   * 发起一次运行。
   * 运行中调用必须给出 streamingBehavior，否则抛错，避免内核并发运行。
   */
  async prompt(text: string, options?: PromptOptions): Promise<void> {
    if (this._isAgentRunActive) {
      if (!options?.streamingBehavior) {
        throw new Error('会话正在运行中，请等待完成，或通过 streamingBehavior 排队');
      }
      if (options.streamingBehavior === 'steer') {
        await this.steer(text, options.images);
      } else {
        await this.followUp(text, options.images);
      }
      return;
    }

    this._isAgentRunActive = true;
    try {
      // run 开始前先检查一次：单轮 run（模型不调工具）没有 turn 间钩子，只能在这里兜住
      await this._compactIfNeeded(this.agent.state.messages);
      await this.agent.prompt(text, options?.images);
    } catch (error) {
      // agent_start 未触发时不会有 agent_end 来复位运行标志
      this._isAgentRunActive = false;
      throw error;
    }
  }

  /** 运行中插话：在当前助手 turn 的工具结果之后注入。 */
  async steer(text: string, images?: ImageContent[]): Promise<void> {
    this._steeringMessages.push(text);
    await this._emitQueueUpdate();
    this.agent.steer(this._buildUserMessage(text, images));
  }

  /** 运行中追加：本次运行本要结束时接着执行。 */
  async followUp(text: string, images?: ImageContent[]): Promise<void> {
    this._followUpMessages.push(text);
    await this._emitQueueUpdate();
    this.agent.followUp(this._buildUserMessage(text, images));
  }

  /** 清空尚未注入的排队消息。 */
  async clearQueue(): Promise<void> {
    this.agent.clearAllQueues();
    this._steeringMessages = [];
    this._followUpMessages = [];
    await this._emitQueueUpdate();
  }

  /** 中断当前运行，并丢弃尚未注入的排队消息。 */
  async abort(): Promise<void> {
    await this.clearQueue();
    this.compactionAbortController?.abort();
    this.agent.abort();
  }

  /** 等待当前运行结束；没有运行时立即返回。 */
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  /** 释放会话：中断运行、等待这一轮落库完成、解除事件订阅。可重复调用。 */
  async dispose(): Promise<void> {
    await this.abort();
    await this.agent.waitForIdle();
    this._disconnectFromAgent();
  }

  /**
   * 把压缩挂到内核的 turn 钩子上：每个 turn 结束、下一次请求之前检查一次。
   * 只有真的压缩了才返回新的 context——否则换一份等价快照没有意义。
   */
  private _initNextTurnRefresh(): void {
    this.agent.prepareNextTurn = async turn => {
      const compacted = await this._compactIfNeeded(turn.context.messages);
      if (!compacted) return undefined;
      return { context: { ...turn.context, messages: this.agent.state.messages.slice() } };
    };
  }

  /**
   * 上下文接近窗口上限时就压缩一次，返回是否真的压缩了。
   * 检查点有两处：run 开始前与每个 turn 之间（见调用处）。
   */
  private async _compactIfNeeded(messages: AgentMessage[]): Promise<boolean> {
    const model = this.model;
    if (!model || model.contextWindow <= 0) return false;

    const settings = DEFAULT_COMPACTION_SETTINGS;
    if (!shouldCompact(estimateContextTokens(messages).tokens, model.contextWindow, settings)) {
      return false;
    }
    return this._runCompaction('threshold', settings);
  }

  /**
   * 执行一次压缩：准备摘要窗口 → 独立 LLM 请求生成摘要 → 落库并替换上下文。
   * 失败（含被中断）只发事件、不抛错，运行照常继续。
   */
  private async _runCompaction(
    reason: 'manual' | 'threshold' | 'overflow',
    settings: CompactionSettings
  ): Promise<boolean> {
    const model = this.model;
    if (!model) return false;

    const preparation = prepareCompaction([...this.sessionManager.getEntries()], settings);
    // 没有可摘要的内容（日志为空 / 末尾已是压缩标记 / 保留区已覆盖全部），不表演一次空压缩
    if (!preparation) return false;

    // 摘要请求可能耗时较长，期间允许用户中断
    this.compactionAbortController = new AbortController();
    const signal = this.compactionAbortController.signal;
    await this._emit({ type: 'compaction_start', reason });

    try {
      const summary = await compact({
        streamFn: this.agent.streamFunction,
        model,
        messages: preparation.messagesToSummarize,
        previousSummary: preparation.previousSummary,
        signal,
      });

      if (signal.aborted) {
        await this._emit({
          type: 'compaction_end',
          reason,
          result: undefined,
          aborted: true,
          willRetry: false,
        });
        return false;
      }

      const tokensBefore = estimateContextTokens(
        this.sessionManager.buildContext().messages
      ).tokens;
      const result = this._commitCompaction(preparation, summary, tokensBefore);
      await this._emit({
        type: 'compaction_end',
        reason,
        result,
        aborted: false,
        willRetry: false,
      });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'compaction failed';
      await this._emit({
        type: 'compaction_end',
        reason,
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage:
          reason === 'overflow'
            ? `Context overflow recovery failed: ${errorMessage}`
            : `Auto-compaction failed: ${errorMessage}`,
      });
      return false;
    } finally {
      this.compactionAbortController = undefined;
    }
  }

  /**
   * 落库 + 替换内存消息：写一条 compaction entry，再把内核的 messages 换成「摘要 + 保留区」。
   * 内核每次 run 都从 state.messages 重新快照，不换这里的话压缩只对本次 run 有效。
   */
  private _commitCompaction(
    preparation: CompactionPreparation,
    summary: CompactionSummary,
    tokensBefore: number
  ): CompactionResult {
    const { firstKeptEntryId } = preparation;
    this.sessionManager.appendCompaction({ ...summary, firstKeptEntryId, tokensBefore });

    // buildContext 会按刚才写入的压缩标记截断，取出压缩后真正该进上下文的消息
    const messages = this.sessionManager.buildContext().messages;
    this.agent.state.messages = messages;

    return {
      ...summary,
      firstKeptEntryId,
      tokensBefore,
      estimatedTokensAfter: estimateContextTokens(messages).tokens,
    };
  }

  get model(): Model<any> | undefined {
    return this.agent.state.model;
  }
}
