import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ImageContent, ThinkingLevel } from '@shared/types/chat';
import type { AppUIMessage } from '@/types/message';
import type { ChatStatus } from '@/components/chat/message/utils';
import { useSessionStore } from '@/stores/session-store';
import { abortChatStream, sendChatMessage } from '@/stores/chat-requests';
import { notifySessionsChanged } from '@/hooks/use-sessions';

/** 稳定的空数组引用，避免 zustand selector 每次返回新数组导致无限渲染 */
const EMPTY_MESSAGES: AppUIMessage[] = [];

/** 会话已被另一个对话界面占用时抛出：同一会话同一时刻只允许一处打开 */
export class SessionOccupiedError extends Error {
  constructor() {
    super('该会话正在别处使用');
    this.name = 'SessionOccupiedError';
  }
}

/** 对话界面持有的会话配置 */
export interface ChatOptions {
  /** 关联书籍 id，随每次发送交给主进程；临时会话不传，退化为通用问答 */
  bookId?: string;
  /** 临时会话：落库时打标记、不进会话列表，界面卸载时连库一起删除 */
  ephemeral?: boolean;
}

/**
 * useChat：每个对话界面（SideChat / ChatPage / TempSideChat）独享一份聊天状态。
 * - activeSessionId 由前端生成：组件挂载即持有一个新会话 id
 * - messages / isStreaming 从 sessionStore 派生（订阅驱动）
 * - bookId 在创建时绑定，随每次发送交给主进程
 * - 组件卸载时自动 release 当前会话；临时会话额外删除库中的会话与 entry
 */
export function useChat({ bookId, ephemeral = false }: ChatOptions = {}) {
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());
  /** 正在从库里载入要切换到的会话；期间消息区只显示加载态 */
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  // ref 用于在回调中读取当前 activeSessionId（通过 useEffect 同步，避开 render 赋值限制）
  const activeRef = useRef<string>(activeSessionId);
  useEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);

  // 从 store 派生：messages / isStreaming
  const messages = useSessionStore(s => s.sessionsMap[activeSessionId]?.messages ?? EMPTY_MESSAGES);
  const isStreaming = useSessionStore(s => s.sessionsMap[activeSessionId]?.isStreaming ?? false);

  /** 卸载清理要能判断该释放还是销毁，而 effect 闭包里读不到最新 props，这里用 effect 同步 */
  const ephemeralRef = useRef(ephemeral);
  useEffect(() => {
    ephemeralRef.current = ephemeral;
  }, [ephemeral]);

  /** 组件卸载：释放当前会话；临时会话连同挂载时创建的那个会话一起销毁 */
  useEffect(() => {
    // 挂载时的会话 id 在这里取：分支会把 activeSessionId 换成持久会话，清理时按当前值删会误删
    const ephemeralSessionId = activeRef.current;

    return () => {
      const currentId = activeRef.current;
      if (currentId) {
        useSessionStore.getState().releaseSession(currentId);
      }
      if (!ephemeralRef.current) return;
      // 临时会话会在组件销毁时移除
      useSessionStore.getState().removeSession(ephemeralSessionId);
      // 首条消息之前库里没有会话行，删除对不存在的会话是空操作；失败时没有可提示的地方，残留行不影响列表
      window.api.deleteSession({ sessionId: ephemeralSessionId }).catch((error: unknown) => {
        console.error('[useChat] 临时会话删除失败:', error);
      });
    };
  }, []);

  /** 切到指定会话。已被其它对话界面占用时抛 SessionOccupiedError */
  const switchSession = useCallback(async (sessionId: string) => {
    const oldId = activeRef.current;
    if (oldId === sessionId) return;

    const store = useSessionStore.getState();

    // 占用检查
    const target = store.sessionsMap[sessionId];
    if (target?.isOccupied) {
      throw new SessionOccupiedError();
    }

    // 不在内存里时要读库：先亮加载态，读库期间消息区显示加载中而不是空白
    const needsLoad = !target;
    if (needsLoad) {
      setIsLoadingSession(true);
    }

    try {
      if (needsLoad) {
        await useSessionStore.getState().loadSession(sessionId);
        if (!useSessionStore.getState().sessionsMap[sessionId]) {
          throw new Error('加载会话失败，请重试');
        }
      }

      // 加载成功后再占有，避免同一会话被多个对话界面同时打开
      if (!useSessionStore.getState().claimSession(sessionId)) {
        throw new SessionOccupiedError();
      }

      // 新会话就绪后再释放旧会话：中途失败时仍停留在原来的会话上
      if (oldId) {
        useSessionStore.getState().releaseSession(oldId);
      }

      setActiveSessionId(sessionId);
    } finally {
      if (needsLoad) {
        setIsLoadingSession(false);
      }
    }
  }, []);

  /**
   * 发送输入区产出的一条消息：思考级别随消息带出，bookId 在创建 hook 时绑定。
   * 失败提示与「首条消息后刷新会话列表」也只在这里处理一次。
   */
  const sendMessage = useCallback(
    async (payload: { content: string; images: ImageContent[]; thinkingLevel: ThinkingLevel }) => {
      const isFirstMessage =
        (useSessionStore.getState().sessionsMap[activeRef.current]?.messages.length ?? 0) === 0;

      try {
        await sendChatMessage({
          sessionId: activeRef.current,
          text: payload.content,
          images: payload.images,
          thinkingLevel: payload.thinkingLevel,
          bookId,
          ephemeral,
        });
        // 首条消息才会在库里建会话行，通知历史列表重新拉取；临时会话不进列表，没有可刷新的
        if (isFirstMessage && !ephemeral) {
          notifySessionsChanged();
        }
      } catch {
        toast.error('发送消息失败，请重试');
      }
    },
    [bookId, ephemeral]
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

  /**
   * 无条件换一个新会话。
   * 删除当前会话后要用它：那时会话已不在 store 里，startNewSession 会提前返回。
   */
  const resetSession = useCallback(() => {
    const oldId = activeRef.current;
    if (oldId) {
      useSessionStore.getState().releaseSession(oldId);
    }
    setActiveSessionId(crypto.randomUUID());
  }, []);

  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  return {
    messages,
    isStreaming,
    chatStatus,
    activeSessionId,
    isLoadingSession,
    switchSession,
    sendMessage,
    abortStream,
    startNewSession,
    resetSession,
  };
}

/** 一个对话界面持有的会话接口；SideChat / ChatPage 与共用零件之间用它传状态，避免逐字段透传 */
export type ChatSession = ReturnType<typeof useChat>;
