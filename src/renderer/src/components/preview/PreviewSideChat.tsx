import { memo, useState } from 'react';
import { Clock, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { InputBar } from '@/components/chat/InputBar';
import { SessionSummaryList } from '@/components/chat/SessionSummaryList';
import { useChat, type ChatSession } from '@/hooks/use-chat';
import { useSessionActions } from '@/hooks/use-session-actions';

/**
 * 预览页右栏的对话。
 *
 * 会话由它自己持有：预览页只负责「开 / 关」这一栏，不关心会话切换。
 * 会话列表挪到头部的时间图标里——它和阅读是两件事，不该占着一整栏。
 * 不复用 chat/SideChat：那一份绑在旧阅读器上，即将整体淘汰。
 */
export const PreviewSideChat = memo(function PreviewSideChat({ onClose }: { onClose: () => void }) {
  const session = useChat({});
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pl-1.5 pr-1">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            {/* IconButton 自带 Tooltip，放进 asChild 触发器会让弹层打不开，这里用 Button */}
            <Button variant="ghost" size="sm" icon aria-label="会话历史" title="会话历史">
              <Clock />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-80 p-0">
            <HistoryPanel session={session} onClose={() => setHistoryOpen(false)} />
          </PopoverContent>
        </Popover>

        <span className="text-sm font-semibold">对话</span>

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
        <IconButton label="收起对话" onClick={onClose}>
          <X />
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

/** 历史弹层内容：只有打开时才挂载 */
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
