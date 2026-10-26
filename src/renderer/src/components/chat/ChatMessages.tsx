import { Loader2, Sparkles } from 'lucide-react';
import { MessageList } from '@/components/chat/message/MessageList';
import type { ChatSession } from '@/hooks/use-chat';
import { notifySessionsChanged } from '@/hooks/use-sessions';

/** 空状态里的起点示例：只作提示，不承担输入行为 */
const EMPTY_EXAMPLES = ['按第 3 章生成 5 张闪卡', '解释我选中的这段', '出一份 10 题自测'];

/**
 * 消息区：加载态 / 空状态 / 消息列表三选一。
 * SideChat 与 ChatPage 共用，保证这三种状态与分支处理只有一份。
 */
export function ChatMessages({ session }: { session: ChatSession }) {
  const { messages, chatStatus, activeSessionId, switchSession, isLoadingSession } = session;

  /** 分支出新会话后，让常驻的会话列表立刻多出一行 */
  const handleForked = (sessionId: string) => {
    notifySessionsChanged();
    void switchSession(sessionId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isLoadingSession && <ChatSessionLoading />}
      {!isLoadingSession && messages.length === 0 && <ChatEmptyState />}
      {!isLoadingSession && messages.length > 0 && (
        <MessageList
          messages={messages}
          status={chatStatus}
          sessionId={activeSessionId}
          onForked={handleForked}
        />
      )}
    </div>
  );
}

/** 切换会话时的占位：读库通常很快，这里只给一个安静的加载态 */
function ChatSessionLoading() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      加载中…
    </div>
  );
}

/** 空状态：给几个起点示例，比一行「开始新对话」更容易上手 */
function ChatEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-primary-surface text-primary">
        <Sparkles className="size-4" />
      </div>
      <p className="text-body-lg font-semibold">想从哪里开始？</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        读完的章节、没看懂的段落、想快问快答的知识点，直接丢进来就行。
      </p>
      <div className="mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
        {EMPTY_EXAMPLES.map(example => (
          <span
            key={example}
            className="rounded-full border border-stroke-2 bg-background px-2.5 py-1 text-xs text-ink-secondary"
          >
            {example}
          </span>
        ))}
      </div>
    </div>
  );
}
