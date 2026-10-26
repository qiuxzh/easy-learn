import { useCallback, useState } from 'react';
import type { SessionSummary } from '@shared/types/chat';
import { useSessionStore } from '@/stores/session-store';

/** 会话清单发生变化（新建 / 改名 / 删除）时广播，其它已挂载的列表据此重新拉取 */
export function notifySessionsChanged(): void {
  window.dispatchEvent(new Event('sessions:changed'));
}

/**
 * useSessions：会话目录（id / 标题 / 更新时间）的状态与操作。
 * - 状态：当前调用方持有的一份列表，与后端 DB 同步
 * - 操作：load / rename / delete，均先走 IPC，再更新本地列表
 *
 * 数据流：
 *   1. 调用方挂载或显式 loadSessions 时，从后端拉全量列表
 *   2. rename / delete 成功后本地增量更新，并广播 sessions:changed 让其它入口重拉
 *   3. deleteSession 一并清理会话运行时缓存（useSessionStore）
 *   4. loadSessions 自行吞错（后台刷新）；rename / delete 失败向上抛，由调用方提示
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

  /** 重命名会话：后端成功后本地增量更新并广播；失败向上抛，由调用方提示 */
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    await window.api.renameSession({ sessionId, title });
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
    notifySessionsChanged();
  }, []);

  /** 删除会话：后端成功后本地移除 + 清理运行时缓存；失败向上抛，由调用方提示 */
  const deleteSession = useCallback(async (sessionId: string) => {
    await window.api.deleteSession({ sessionId });
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    useSessionStore.getState().removeSession(sessionId);
    notifySessionsChanged();
  }, []);

  return { sessions, loadSessions, renameSession, deleteSession };
}
