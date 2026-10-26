import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { SessionOccupiedError, type ChatSession } from '@/hooks/use-chat';
import { useSessions } from '@/hooks/use-sessions';

/**
 * useSessionActions：历史入口（ChatPage 左栏 / SideChat 历史弹层）共用的会话列表行为。
 * - 列表由 useSessions 持有，每个入口一份，通过 sessions:changed 事件保持一致
 * - 切换占用提示、删除后去哪，都只在这里实现一次
 */
export function useSessionActions(session: ChatSession) {
  const { switchSession, activeSessionId, resetSession } = session;
  const { sessions, loadSessions, renameSession, deleteSession } = useSessions();

  // 入口挂载时拉一次：历史弹层只在打开时挂载，相当于「打开即刷新」
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // 任何入口建 / 删 / 改名后，其它已挂载的列表跟着刷新
  useEffect(() => {
    const refresh = () => void loadSessions();
    window.addEventListener('sessions:changed', refresh);
    return () => window.removeEventListener('sessions:changed', refresh);
  }, [loadSessions]);

  /** 切换会话；被其它对话界面占用时用 toast 提示，返回是否切换成功 */
  const select = useCallback(
    async (sessionId: string) => {
      try {
        await switchSession(sessionId);
        return true;
      } catch (error) {
        if (error instanceof SessionOccupiedError) {
          toast.error(error.message);
          return false;
        }
        throw error;
      }
    },
    [switchSession]
  );

  /** 重命名：失败时提示并向上抛，让弹窗保持打开、保留用户输入 */
  const rename = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await renameSession(sessionId, title);
      } catch (error) {
        toast.error('重命名失败，请重试');
        throw error;
      }
    },
    [renameSession]
  );

  /**
   * 删除会话：先删库，成功后才换走当前会话。
   * 失败时保持原会话不变，只提示错误，避免「切走了但没删掉」。
   */
  const remove = useCallback(
    async (sessionId: string) => {
      const isActive = sessionId === activeSessionId;
      try {
        await deleteSession(sessionId);
      } catch {
        toast.error('删除会话失败，请重试');
        return;
      }

      if (isActive) {
        resetSession();
      }
      toast.success('会话已删除');
    },
    [activeSessionId, resetSession, deleteSession]
  );

  return { sessions, select, rename, remove };
}

/** 历史入口拿到的列表接口；用于给列表容器声明 props */
export type SessionHistory = ReturnType<typeof useSessionActions>;
