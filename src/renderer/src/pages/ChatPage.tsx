import { memo, useState } from 'react';
import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { InputBar } from '@/components/chat/InputBar';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { SessionSummaryList } from '@/components/chat/SessionSummaryList';
import { useChat } from '@/hooks/use-chat';
import { useSessionActions } from '@/hooks/use-session-actions';

/**
 * 对话 Tab：左侧会话栏 + 右侧对话列。
 * 侧栏与会话头只服务这一页，所以留在同一个文件里；
 * 面板形态（阅读器右栏、闪卡助手）见 components/chat/SideChat 的 SideChat。
 */
export const ChatPage = memo(function ChatPage({ bookId }: { bookId?: string }) {
  const session = useChat(bookId);
  const history = useSessionActions(session);
  const [collapsed, setCollapsed] = useState(false);

  // 当前会话标题：首条消息前会话还没落库，回退成「新会话」
  const title =
    history.sessions.find(item => item.id === session.activeSessionId)?.title ?? '新会话';

  return (
    <div className="flex h-full min-h-0">
      {!collapsed && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-stroke-3 bg-surface-1">
          {/* 新会话做成列表的第一行：与会话行同一套高度、圆角与 hover */}
          <div className="flex shrink-0 flex-col p-2">
            <Button
              variant="ghost"
              size="md"
              className="w-full justify-start gap-2 rounded-sm px-2 text-sm"
              onClick={session.startNewSession}
            >
              <MessageSquarePlus />
              新会话
            </Button>
          </div>
          <SessionSummaryList
            variant="sidebar"
            sessions={history.sessions}
            activeSessionId={session.activeSessionId}
            onSelect={history.select}
            onRename={history.rename}
            onDelete={history.remove}
          />
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke-3 px-2">
          <IconButton
            label={collapsed ? '展开会话列表' : '收起会话列表'}
            onClick={() => setCollapsed(value => !value)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
          <span className="min-w-0 truncate text-body font-semibold">{title}</span>
        </div>

        <ChatMessages session={session} />
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4">
          <InputBar
            size="lg"
            status={session.chatStatus}
            onSend={session.sendMessage}
            onStop={session.abortStream}
          />
        </div>
      </div>
    </div>
  );
});
