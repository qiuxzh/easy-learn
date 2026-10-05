import { useCallback, useState } from 'react';
import type { SessionSummary } from '@shared/types/chat';
import { useSessionStore } from '@/stores/session-store';

/**
 * useSessions：会话列表相关的状态与操作。
 * - 状态：本组件使用的会话列表（与后端 DB 同步）
 * - 操作：load / rename / delete（均通过 IPC 调用后端，再更新本地状态）
 *
 * 数据流：
 *   1. 调用方首次 mount 时或显式触发 loadSessions，从后端拉全量列表
 *   2. rename/delete 成功后本地增量更新（避免再请求一次）
 *   3. deleteSession 同步清理本地会话缓存
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  /** 从后端加载全量会话列表 */
  const loadSessions = useCallback(async () => {
    try {
      const data = await window.api.listSessions();
      setSessions(data);
    } catch {
      /* ignore */
    }
  }, []);

  /** 重命名会话：后端持久化成功后本地增量更新 */
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      await window.api.renameSession({ sessionId, title });
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
    } catch {
      /* ignore */
    }
  }, []);

  /** 删除会话：后端持久化成功后本地移除 + 清理本地会话缓存 */
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await window.api.deleteSession({ sessionId });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      useSessionStore.getState().removeSession(sessionId);
    } catch {
      /* ignore */
    }
  }, []);

  return { sessions, loadSessions, renameSession, deleteSession };
}
