import { Loader2, Sparkles } from 'lucide-react';
import { MessageList } from '@/components/chat/message/MessageList';
import type { ChatSession } from '@/hooks/use-chat';
import { notifySessionsChanged } from '@/hooks/use-sessions';

/** 空状态里的起点示例：只作提示，不承担输入行为 */
const BOOK_EXAMPLES = ['按第 3 章生成 5 张闪卡', '解释我选中的这段', '出一份 10 题自测'];
const GENERAL_EXAMPLES = ['用简单的话解释这个概念', '帮我把思路理一遍', '这条结论有什么反例'];

/**
 * 消息区：加载态 / 空状态 / 消息列表三选一。
 * SideChat 与 ChatPage 共用，保证这三种状态与分支处理只有一份。
 *
 * `variant` 只影响空状态文案：不绑书的临时会话谈不了章节与闪卡，示例得换成通用问法。
 * `forkable` 关掉消息上的分支入口：临时会话产生的是持久会话，会脱离「关闭即销毁」的语义。
 */
export function ChatMessages({
  session,
  variant = 'book',
  forkable = true,
}: {
  session: ChatSession;
  variant?: 'book' | 'general';
  forkable?: boolean;
}) {
  const { messages, chatStatus, activeSessionId, switchSession, isLoadingSession } = session;

  /** 分支出新会话后，让常驻的会话列表立刻多出一行 */
  const handleForked = (sessionId: string) => {
    notifySessionsChanged();
    void switchSession(sessionId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isLoadingSession && <ChatSessionLoading />}
      {!isLoadingSession && messages.length === 0 && <ChatEmptyState variant={variant} />}
      {!isLoadingSession && messages.length > 0 && (
        <MessageList
          messages={messages}
          status={chatStatus}
          // 不给 sessionId 时 MessageList 不渲染分支按钮
          sessionId={forkable ? activeSessionId : undefined}
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
function ChatEmptyState({ variant }: { variant: 'book' | 'general' }) {
  const examples = variant === 'book' ? BOOK_EXAMPLES : GENERAL_EXAMPLES;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-primary-surface text-primary">
        <Sparkles className="size-4" />
      </div>
      <p className="text-body-lg font-semibold">
        {variant === 'book' ? '想从哪里开始？' : '临时会话'}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {variant === 'book'
          ? '读完的章节、没看懂的段落、想快问快答的知识点，直接丢进来就行。'
          : '随手问点什么，关掉面板这段对话就不留痕。'}
      </p>
      <div className="mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
        {examples.map(example => (
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
