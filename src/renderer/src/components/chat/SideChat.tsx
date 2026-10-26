import { memo, useState } from 'react';
import { Clock, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InputBar } from '@/components/chat/InputBar';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { SessionSummaryList } from '@/components/chat/SessionSummaryList';
import { useChat, type ChatSession } from '@/hooks/use-chat';
import { useSessionActions } from '@/hooks/use-session-actions';

/**
 * 侧栏形态的对话：阅读器右栏、闪卡 AI 助手共用。
 * 顶栏与历史弹层只服务于这一形态，所以留在同一个文件里。
 * 整页形态见 pages/ChatPage 的 ChatPage。
 */
export const SideChat = memo(function SideChat({ bookId }: { bookId?: string }) {
  const session = useChat(bookId);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            {/* IconButton 自带 Tooltip，放进 asChild 触发器会让弹层打不开，这里用 Button */}
            <Button variant="ghost" size="sm" icon aria-label="查看历史" title="查看历史">
              <Clock />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-80 p-0">
            <HistoryPanel session={session} onClose={() => setHistoryOpen(false)} />
          </PopoverContent>
        </Popover>

        <IconButton
          label="开启新会话"
          className="ml-auto"
          onClick={() => {
            setHistoryOpen(false);
            session.startNewSession();
          }}
        >
          <MessageSquarePlus />
        </IconButton>
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
  );
});

/** 历史弹层内容：只有打开时才挂载，加载时机与之前一致 */
function HistoryPanel({ session, onClose }: { session: ChatSession; onClose: () => void }) {
  const history = useSessionActions(session);

  return (
    <div>
      <div className="border-b border-stroke-3 px-4 py-3">
        <h3 className="text-sm font-semibold">会话历史</h3>
      </div>
      <SessionSummaryList
        variant="popover"
        sessions={history.sessions}
        activeSessionId={session.activeSessionId}
        onSelect={async sessionId => {
          if (await history.select(sessionId)) onClose();
        }}
        onRename={history.rename}
        onDelete={history.remove}
      />
    </div>
  );
}
