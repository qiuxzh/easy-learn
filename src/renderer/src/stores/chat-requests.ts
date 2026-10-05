import type { StreamSendRequest } from '@shared/types/chat';
import { useSessionStore } from '@/stores/session-store';

/**
 * chat-requests：渲染层发往主进程的会话调用。
 *
 * 只负责请求方向的本地状态编排（置运行标志、失败回滚）；
 * 接收方向的事件翻译见 chatStreamController，两者互不依赖。
 */

/**
 * 发送用户消息：本地只置运行标志，消息本体等主进程回放的 message_start 渲染；
 * 失败时回滚并抛回原错误。
 */
export async function sendChatMessage(params: StreamSendRequest): Promise<void> {
  useSessionStore.getState().beginRequest(params.sessionId);

  try {
    await window.api.sendMessage(params);
  } catch (error) {
    useSessionStore.getState().rollbackRequest(params.sessionId);
    throw error;
  }
}

/** 中止指定会话正在进行的运行。 */
export async function abortChatStream(sessionId: string): Promise<void> {
  try {
    await window.api.streamAbort({ sessionId });
  } catch {
    // 中止是幂等操作：即便这次调用失败，运行也会自行走到收尾
  }
}
