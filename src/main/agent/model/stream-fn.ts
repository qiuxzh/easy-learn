import type { Api, AssistantMessage } from '@shared/types/chat';
import type { Context, Model, StreamOptions } from './types';
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from './utils/event-stream';

/**
 * Agent 循环使用的流式函数：把一次模型请求变成一条助手消息事件流。
 *
 * 约定：
 * - 不得为请求/模型/运行时故障抛出异常或返回被拒绝的 Promise。
 * - 必须返回 AssistantMessageEventStream。
 * - 故障必须通过协议事件编码在返回的流中，并以 stopReason 为 "error" 或 "aborted"
 *   且带 errorMessage 的最终 AssistantMessage 结尾。
 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: StreamOptions
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/**
 * 造一条以 error 收尾的事件流，用于请求都没能发起的场景（如未知 api 协议）。
 * 返回值同样满足 StreamFn 的约定：不抛异常，故障编码进事件流
 */
export function createFailedStream(
  model: Model<Api>,
  message: string
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const failed: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
  stream.push({ type: 'error', reason: 'error', error: failed });
  return stream;
}
