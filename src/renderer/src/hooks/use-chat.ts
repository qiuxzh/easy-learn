import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageContent, ThinkingLevel } from '@shared/types/chat';
import type { AppUIMessage } from '@/types/message';
import type { ChatStatus } from '@/components/chat/message/utils';
import { useSessionStore } from '@/stores/session-store';
import { abortChatStream, sendChatMessage } from '@/stores/chat-requests';

/** 稳定的空数组引用，避免 zustand selector 每次返回新数组导致无限渲染 */
const EMPTY_MESSAGES: AppUIMessage[] = [];

/** 会话被其他 tab 占用时抛出 */
export class SessionOccupiedError extends Error {
  constructor() {
    super('该会话正在被其他标签页占用');
    this.name = 'SessionOccupiedError';
  }
}

/**
 * useChat：每个 Chat 组件实例独享一份聊天状态。
 * - activeSessionId 由前端生成：组件挂载即持有一个新会话 id
 * - messages / isStreaming 从 sessionStore 派生（订阅驱动）
 * - 组件卸载时自动 release 当前会话
 */
export function useChat() {
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());

  // ref 用于在回调中读取当前 activeSessionId（通过 useEffect 同步，避开 render 赋值限制）
  const activeRef = useRef<string>(activeSessionId);
  useEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);

  // 从 store 派生：messages / isStreaming
  const messages = useSessionStore(s => s.sessionsMap[activeSessionId]?.messages ?? EMPTY_MESSAGES);
  const isStreaming = useSessionStore(s => s.sessionsMap[activeSessionId]?.isStreaming ?? false);

  /** 组件卸载：释放当前会话 */
  useEffect(() => {
    return () => {
      const oldId = activeRef.current;
      if (oldId) {
        useSessionStore.getState().releaseSession(oldId);
      }
    };
  }, []);

  /** 切到指定会话。被其他 tab 占用时抛 SessionOccupiedError */
  const switchSession = useCallback(async (sessionId: string) => {
    const oldId = activeRef.current;
    if (oldId === sessionId) return;

    const store = useSessionStore.getState();

    // 占用检查
    const target = store.sessionsMap[sessionId];
    if (target?.isOccupied) {
      throw new SessionOccupiedError();
    }

    // 释放旧会话
    if (oldId) {
      store.releaseSession(oldId);
    }

    // 必要时载入历史消息
    if (!target) {
      await useSessionStore.getState().loadSession(sessionId);
    }

    if (!useSessionStore.getState().sessionsMap[sessionId]) {
      throw new Error('加载会话失败，请重试');
    }

    // 加载成功后再占用，避免同一会话被多个 tab 同时打开
    if (!useSessionStore.getState().claimSession(sessionId)) {
      throw new SessionOccupiedError();
    }

    setActiveSessionId(sessionId);
  }, []);

  /** 发送用户消息：本地建立消息与流式状态，再发起请求 */
  const sendMessage = useCallback(
    async (req: {
      text: string;
      images?: ImageContent[];
      thinkingLevel?: ThinkingLevel;
      bookId?: string;
    }) => {
      await sendChatMessage({ sessionId: activeRef.current, ...req });
    },
    []
  );

  /** 中止当前流式响应 */
  const abortStream = useCallback(async () => {
    await abortChatStream(activeRef.current);
  }, []);

  /** 开启新会话：当前会话已有记录时才换新的 id，空会话不重复新建 */
  const startNewSession = useCallback(() => {
    const oldId = activeRef.current;
    const current = useSessionStore.getState().sessionsMap[oldId];
    if (!current || (current.messages.length === 0 && !current.isStreaming)) return;

    useSessionStore.getState().releaseSession(oldId);
    setActiveSessionId(crypto.randomUUID());
  }, []);

  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  return {
    messages,
    isStreaming,
    chatStatus,
    activeSessionId,
    switchSession,
    sendMessage,
    abortStream,
    startNewSession,
  };
}
