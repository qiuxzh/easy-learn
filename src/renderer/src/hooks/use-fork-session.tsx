import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ForkSessionDialog } from '@/components/chat/ForkSessionDialog';

/** useForkSession 的入参。 */
interface UseForkSessionOptions {
  /** 从哪个会话分支；未提供时不具备分支能力 */
  sessionId?: string;
  /** 分支创建成功后的回调，宿主据此切到新会话 */
  onForked?: (sessionId: string) => void;
}

/**
 * useForkSession：分支会话的交互与请求。
 * 宿主只给出当前会话 id 与"切到新会话"的回调，默认名、命名弹窗、提示都在这里收口，
 * 因此渲染消息列表的地方不必各自再写一遍分支逻辑。
 */
export function useForkSession({ sessionId, onForked }: UseForkSessionOptions) {
  /** 待创建分支的分支点；非空表示命名弹窗打开 */
  const [entryId, setEntryId] = useState<string | null>(null);
  /** 命名弹窗里预填的名称 */
  const [defaultTitle, setDefaultTitle] = useState('分支');
  /** 是否正在创建分支 */
  const [pending, setPending] = useState(false);

  /**
   * 请求从某条助手回复分支：先取当前会话标题拼默认名，再打开命名弹窗（此时还不发请求）。
   * 标题只为预填名称服务，从会话列表里取，不为它单开一条通道。
   */
  const requestFork = useCallback(
    async (forkEntryId: string) => {
      if (sessionId === undefined) return;

      let title = '分支';
      try {
        const sessions = await window.api.listSessions();
        const current = sessions.find(session => session.id === sessionId);
        if (current?.title) {
          title = `${current.title} (分支)`;
        }
      } catch {
        /* 取不到就用占位名，用户仍可自己改 */
      }
      setEntryId(forkEntryId);
      setDefaultTitle(title);
    },
    [sessionId]
  );

  /** 确认创建：成功后收起弹窗并通知宿主切换，失败时留着让用户改完重试 */
  const confirmFork = useCallback(
    async (title: string) => {
      if (sessionId === undefined || entryId === null) return;

      setPending(true);
      try {
        const { summary } = await window.api.forkSession({ sessionId, entryId, title });
        toast.success('分支已创建');
        setEntryId(null);
        onForked?.(summary.id);
      } catch {
        toast.error('创建分支失败，请重试');
      } finally {
        setPending(false);
      }
    },
    [sessionId, entryId, onForked]
  );

  /** 命名弹窗；创建中不允许关闭，避免请求还在飞就失去反馈 */
  const forkDialog =
    entryId === null ? null : (
      <ForkSessionDialog
        defaultTitle={defaultTitle}
        pending={pending}
        onOpenChange={open => {
          if (!open && !pending) {
            setEntryId(null);
          }
        }}
        onConfirm={confirmFork}
      />
    );

  return { requestFork, forkDialog };
}
