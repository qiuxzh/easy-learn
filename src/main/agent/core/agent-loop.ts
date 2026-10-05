import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from '@shared/types/chat';
import { AgentLoopConfig, PrepareNextTurnContext } from './types';
import type { StreamFn } from '../model/stream-fn';
import { AgentContext, AgentToolResult } from './agent';
import { LLMContext } from '../model/types';

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: (event: AgentEvent) => Promise<void> | void,
  signal: AbortSignal | undefined,
  streamFn: StreamFn
): Promise<void> {
  // 提示词属于本次 run，必须先进上下文，否则本轮请求没有任何输入消息
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: 'agent_start' });
  await emit({ type: 'turn_start' });
  let newMessages: AgentMessage[] = [];
  // 约定 turn包含： turn_start 用户消息、助手消息 turn_end
  for (const prompt of prompts) {
    await emit({ type: 'message_start', message: prompt });
    await emit({ type: 'message_end', message: prompt });
    newMessages.push(prompt);
  }
  await runLoop(currentContext, newMessages, config, emit, signal, streamFn);
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: (event: AgentEvent) => Promise<void> | void,
  signal: AbortSignal | undefined,
  streamFn: StreamFn
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [];

  return newMessages;
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  streamFunction: StreamFn,
  emit: (event: AgentEvent) => Promise<void> | void,
  signal: AbortSignal | undefined
): Promise<AssistantMessage> {
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(context.messages, signal);
  }

  const llmMessages: Message[] = await config.convertToLlm(messages);

  const llmContext: LLMContext = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  // AgentLoopConfig 继承自 StreamOptions，请求参数在这里逐个透传给模型适配器
  const response = await streamFunction(config.model, llmContext, {
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    toolChoice: config.toolChoice,
    reasoning: config.reasoning,
    metadata: config.metadata,
    signal,
  });

  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  for await (const event of response) {
    switch (event.type) {
      case 'start':
        partialMessage = event.partial;
        addedPartial = true;
        await emit({ type: 'message_start', message: partialMessage });
        context.messages.push(partialMessage);
        break;
      case 'text_start':
      case 'text_delta':
      case 'text_end':
      case 'thinking_start':
      case 'thinking_delta':
      case 'thinking_end':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end':
        if (partialMessage) {
          // 刷新出最新的 partialMessage
          partialMessage = event.partial;
          await emit({
            type: 'message_update',
            message: partialMessage,
            assistantMessageEvent: event,
          });
          // 刷新
          context.messages[context.messages.length - 1] = partialMessage;
        }
        break;

      case 'done':
      case 'error': {
        const finalMessage = await response.result();
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
        }
        if (!addedPartial) {
          await emit({ type: 'message_start', message: { ...finalMessage } });
        }
        await emit({ type: 'message_end', message: finalMessage });
        return finalMessage;
      }
    }
  }

  const finalMessage = await response.result();

  await emit({ type: 'message_end', message: finalMessage });

  return finalMessage;
}

/**
 * 单次工具调用的执行结果：结果消息，以及是否要求在本批次结束后提前终止
 */
type ToolCallOutcome = {
  message: ToolResultMessage;
  terminate: boolean;
};

type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
};

/** 统一把抛出物转成可读字符串 */
function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 构造一个纯文本的错误工具结果 */
function errorToolResult(text: string): AgentToolResult<any> {
  return { content: [{ type: 'text', text }], details: undefined };
}

/** 把参数校验错误整理成 "路径: 原因" 形式的一行文本 */
function formatValueErrors(schema: TSchema, value: unknown): string {
  return Value.Errors(schema, value)
    .map(error => `${error.instancePath || '/'}: ${error.message}`)
    .join('; ');
}

/**
 * 执行一条工具调用。
 *
 * 流程：发出 tool_execution_start → 校验参数 → beforeToolCall 钩子 → 执行 →
 * afterToolCall 钩子 → 发出 tool_execution_end。
 * 找不到工具、参数不合法、被钩子阻止、执行抛错都会变成 isError 的结果，
 * 不会把异常抛给上层循环
 */
async function executeSingleToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: (event: AgentEvent) => Promise<void> | void
): Promise<ToolCallOutcome> {
  await emit({
    type: 'tool_execution_start',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments,
  });

  const tool = currentContext.tools?.find(candidate => candidate.name === toolCall.name);

  let result: AgentToolResult<any>;
  let isError = false;
  let terminate = false;

  if (!tool) {
    isError = true;
    result = errorToolResult(`未找到名为 "${toolCall.name}" 的工具`);
  } else if (!Value.Check(tool.parameters, toolCall.arguments)) {
    isError = true;
    result = errorToolResult(
      `工具 "${toolCall.name}" 的参数不合法: ${formatValueErrors(tool.parameters, toolCall.arguments)}`
    );
  } else {
    const beforeResult = await config.beforeToolCall?.(
      { assistantMessage, toolCall, args: toolCall.arguments, context: currentContext },
      signal
    );

    if (beforeResult?.block) {
      isError = true;
      terminate = beforeResult.terminate === true;
      result = errorToolResult(beforeResult.reason ?? `工具 "${toolCall.name}" 的调用被阻止`);
    } else {
      terminate = beforeResult?.terminate === true;
      try {
        result = await tool.execute(toolCall.id, toolCall.arguments, signal);
      } catch (error) {
        isError = true;
        result = errorToolResult(stringifyError(error));
      }

      const afterResult = await config.afterToolCall?.(
        {
          assistantMessage,
          toolCall,
          args: toolCall.arguments,
          result,
          isError,
          context: currentContext,
        },
        signal
      );

      if (afterResult) {
        if (afterResult.content) result.content = afterResult.content;
        if (afterResult.details !== undefined) result.details = afterResult.details;
        if (afterResult.isError !== undefined) isError = afterResult.isError;
        if (afterResult.terminate !== undefined) terminate = afterResult.terminate;
      }
    }
  }

  const message: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: result.details,
    addedToolNames: result.addedToolNames,
    isError,
    timestamp: Date.now(),
  };

  await emit({
    type: 'tool_execution_end',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError,
  });

  // 工具结果同样走一遍消息生命周期，使其进入对话记录
  await emit({ type: 'message_start', message });
  await emit({ type: 'message_end', message });

  return { message, terminate };
}

/**
 * 执行一条助手消息中的全部工具调用。
 *
 * 默认并发执行；结果始终按助手消息中的原始顺序返回。
 * 仅当批次内每个工具结果都要求终止时，才把 terminate 置为 true
 */
async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: (event: AgentEvent) => Promise<void> | void
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter(
    (block): block is AgentToolCall => block.type === 'toolCall'
  );
  if (toolCalls.length === 0) {
    return { messages: [], terminate: false };
  }

  const run = (toolCall: AgentToolCall) =>
    executeSingleToolCall(currentContext, assistantMessage, toolCall, config, signal, emit);

  const outcomes: ToolCallOutcome[] = [];
  if ((config.toolExecution ?? 'parallel') === 'sequential') {
    for (const toolCall of toolCalls) {
      outcomes.push(await run(toolCall));
    }
  } else {
    outcomes.push(...(await Promise.all(toolCalls.map(run))));
  }

  return {
    messages: outcomes.map(outcome => outcome.message),
    terminate: outcomes.every(outcome => outcome.terminate),
  };
}

/**
 * 核心主循环。runAgentLoop 和 runAgentLoopContinue
 */
async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[], // 记录本次agent run的完整message
  initialConfig: AgentLoopConfig,
  emit: (event: AgentEvent) => Promise<void> | void,
  signal: AbortSignal | undefined,
  streamFn: StreamFn
): Promise<void> {
  // 标记上一轮turn的信息
  let lastCompletedTurnContext: PrepareNextTurnContext | undefined = undefined;
  // 装steering和follow-up messages
  let pendingMessages: AgentMessage[] = [];

  // context和config可能会中途被修改，使用最新的
  let currentContext = initialContext;
  let currentConfig = initialConfig;

  // tool执行完成后，还需要再进行一轮，用于把结果给AI
  let shouldNextTurn = true;

  while (true) {
    // 每执行完一次就代表执行完了一个turn
    // 执行完turn后context可能会受到hooks的影响有变化（如上下文压缩），因此使用 currentContext
    while (shouldNextTurn || pendingMessages.length > 0) {
      shouldNextTurn = false;
      if (lastCompletedTurnContext) {
        // 以下是两个turn之间的操作
        const nextTurnSnapShot = await currentConfig.prepareNextTurn?.(lastCompletedTurnContext);
        if (nextTurnSnapShot) {
          if (nextTurnSnapShot.context) {
            currentContext = nextTurnSnapShot.context;
          }
          if (nextTurnSnapShot.model) {
            currentConfig.model = nextTurnSnapShot.model;
          }
          if (nextTurnSnapShot.thinkingLevel) {
            currentConfig.reasoning = nextTurnSnapShot.thinkingLevel;
          }
        }

        // 准备过程可能耗时较长（例如上下文压缩 compaction），这期间steer的消息也会被获取
        // 只有pendingMessages为空时，才会拉取steering消息，防止 one-at-a-time 获取到多个消息
        // 可以提升用户的体验，让steering早点响应
        if (pendingMessages.length === 0) {
          pendingMessages = (await currentConfig.getSteeringMessages?.()) || [];
        }

        // 拉取steering消息
        await emit({ type: 'turn_start' });
      }

      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: 'message_start', message });
          await emit({ type: 'message_end', message });
          // 注入的消息同样要进上下文与本轮汇总，否则模型看不到它们
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // streamAssistantResponse 内部会emit事件
      const message = await streamAssistantResponse(
        currentContext,
        currentConfig,
        streamFn,
        emit,
        signal
      );
      newMessages.push(message);

      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        await emit({ type: 'turn_end', message, toolResults: [] });
        await emit({ type: 'agent_end', messages: newMessages });
        return;
      }

      const toolCalls: ToolCall[] = message.content.filter(c => c.type === 'toolCall');

      const toolResults: ToolResultMessage[] = [];
      if (toolCalls.length > 0) {
        let executedToolBatch = await executeToolCalls(
          currentContext,
          message,
          currentConfig,
          signal,
          emit
        );
        toolResults.push(...executedToolBatch.messages);
        shouldNextTurn = !executedToolBatch.terminate;

        for (const toolResult of toolResults) {
          newMessages.push(toolResult);
          currentContext.messages.push(toolResult);
        }
      }

      await emit({ type: 'turn_end', message, toolResults });
      // 当前turn的快照
      lastCompletedTurnContext = {
        context: currentContext,
        message,
        newMessages,
        toolResults,
      };
    }

    // 获取需要处理的follow-up消息
    let followUpMessages = (await currentConfig.getFollowUpMessages?.()) || [];

    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
    } else {
      break;
    }
  }

  await emit({ type: 'agent_end', messages: newMessages });
}
