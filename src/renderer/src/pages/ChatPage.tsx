import { memo, useState } from 'react';
import { MessageSquarePlus, PanelLeft, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { InputBar } from '@/components/chat/InputBar';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { SessionSummaryList } from '@/components/chat/SessionSummaryList';
import { TempSideChat } from '@/components/chat/TempSideChat';
import { useChat } from '@/hooks/use-chat';
import { usePanelWidth, type PanelResizeHandler } from '@/hooks/use-panel-width';
import { useSessionActions } from '@/hooks/use-session-actions';

/** 左侧会话栏的宽度区间：比这更窄放不下标题，更宽会挤掉正文列 */
const SIDEBAR = { defaultWidth: 224, min: 200, max: 400 };
/** 右侧临时会话的宽度区间：比会话栏宽一些，够读一两段回答 */
const TEMP_SIDE_CHAT = { defaultWidth: 360, min: 280, max: 800 };

/**
 * 对话 Tab：左侧会话栏 + 右侧对话列，临时会话按需从右侧弹出。
 * 两侧默认都收起，把宽度留给对话本体。
 * 侧栏、侧会话的分隔条与会话头只服务这一页，所以留在同一个文件里；
 * 面板形态（阅读器右栏、闪卡助手）见 components/chat/SideChat 的 SideChat。
 */
export const ChatPage = memo(function ChatPage({ bookId }: { bookId?: string }) {
  const session = useChat({ bookId });
  const history = useSessionActions(session);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tempSideChatOpen, setTempSideChatOpen] = useState(false);
  // 存储键带版本号：默认宽度变了，不能让人被旧值钉在 256 上
  const sidebarWidth = usePanelWidth({
    ...SIDEBAR,
    storageKey: 'chat-sidebar-width-v2',
    edge: 'start',
  });
  const tempSideChatWidth = usePanelWidth({
    ...TEMP_SIDE_CHAT,
    storageKey: 'chat-temp-side-chat-width',
    edge: 'end',
  });

  // 当前会话标题：首条消息前会话还没落库，回退成「新会话」
  const title =
    history.sessions.find(item => item.id === session.activeSessionId)?.title ?? '新会话';

  return (
    <div className="flex h-full min-h-0">
      {sidebarOpen && (
        <>
          <aside
            style={{ width: sidebarWidth.width }}
            className="flex shrink-0 flex-col border-r border-stroke-3 bg-surface-1"
          >
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
          <ResizeHandle label="调整会话栏宽度" onResize={sidebarWidth.resize} />
        </>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke-3 px-2">
          <IconButton
            pressed={sidebarOpen}
            label={sidebarOpen ? '收起会话列表' : '展开会话列表'}
            onClick={() => setSidebarOpen(value => !value)}
          >
            <PanelLeft />
          </IconButton>
          <span className="min-w-0 truncate text-body font-semibold">{title}</span>
          <IconButton
            className="ml-auto"
            pressed={tempSideChatOpen}
            label={tempSideChatOpen ? '关闭临时会话' : '打开临时会话'}
            onClick={() => setTempSideChatOpen(value => !value)}
          >
            <PanelRight />
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

      {tempSideChatOpen && (
        <>
          <ResizeHandle label="调整临时会话宽度" onResize={tempSideChatWidth.resize} />
          <div
            style={{ width: tempSideChatWidth.width }}
            className="flex shrink-0 flex-col border-l border-stroke-3"
          >
            <TempSideChat onClose={() => setTempSideChatOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
});

/** 分栏之间的拖拽分隔条：平时透明，悬停才显出一条细线 */
function ResizeHandle({ label, onResize }: { label: string; onResize: PanelResizeHandler }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onResize}
      className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border"
    />
  );
}
