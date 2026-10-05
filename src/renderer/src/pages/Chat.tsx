import { useState, useCallback, useEffect, memo } from 'react';
import { Clock } from 'lucide-react';
import { MessageList } from '@/components/chat/message/MessageList';
import { TextShimmer } from '@/components/chat/TextShimmer';
import { InputBar } from '@/components/chat/InputBar';
import { ModeSelector, type ModeOption } from '@/components/chat/ModeSelector';
import { SessionSummaryList } from '@/components/chat/SessionSummaryList';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChat } from '@/hooks/use-chat';
import { IconBolt, IconBrain, IconMessagePlus, IconSparkles } from '@tabler/icons-react';
import type { ImageContent, ThinkingLevel } from '@shared/types/chat';

const thinkingModes: ModeOption[] = [
  { id: 'off', label: '快速回答', icon: IconBolt, description: '直接作答，不额外推理' },
  { id: 'medium', label: '思考', icon: IconBrain, description: '先推理再作答' },
  { id: 'max', label: '深度思考', icon: IconSparkles, description: '花更多推理时间处理复杂问题' },
];

/** 把模式 id 收敛到思考级别；未知取值（如旧版本存下的模式名）一律按不思考处理 */
function toThinkingLevel(modeId: string | null): ThinkingLevel {
  switch (modeId) {
    case 'medium':
      return 'medium';
    case 'max':
      return 'max';
    default:
      return 'off';
  }
}

export const Chat = memo(function Chat({ bookId }: { bookId?: string }) {
  const {
    messages,
    chatStatus,
    activeSessionId,
    switchSession,
    sendMessage,
    abortStream,
    startNewSession,
  } = useChat();

  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() =>
    toThinkingLevel(localStorage.getItem('thinkingMode'))
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('thinkingMode', thinkingLevel);
  }, [thinkingLevel]);

  const handleSend = useCallback(
    async ({ content, images }: { content: string; images: ImageContent[] }) => {
      if ((!content.trim() && images.length === 0) || chatStatus === 'streaming') return;
      try {
        await sendMessage({ text: content, images, thinkingLevel, bookId });
      } catch {
        alert('发送消息失败，请重试');
      }
    },
    [chatStatus, sendMessage, thinkingLevel, bookId]
  );

  const handleStop = () => {
    abortStream();
  };

  /** 开启新会话：关闭历史面板并重置当前 tab 的会话 */
  const handleNewSession = useCallback(() => {
    setHistoryOpen(false);
    startNewSession();
  }, [startNewSession]);

  return (
    <div className="flex flex-col h-full relative">
      <div className="px-3 py-2 shrink-0 flex items-center gap-2">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="查看历史">
              <Clock className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-80 p-0">
            <SessionSummaryList
              activeSessionId={activeSessionId}
              switchSession={switchSession}
              onSelect={() => setHistoryOpen(false)}
              open={historyOpen}
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleNewSession}
          className="h-7 w-7 ml-auto"
          title="开启新会话"
        >
          <IconMessagePlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 relative min-h-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1 flex flex-col min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground text-sm">
                开始新对话
              </div>
            )}
            <MessageList messages={messages} status={chatStatus} />
            {chatStatus === 'streaming' && (
              <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-muted-foreground shrink-0">
                <TextShimmer>思考中...</TextShimmer>
              </div>
            )}
          </div>

          <div className="flex-shrink-0">
            <div className="mx-auto max-w-3xl px-4">
              <InputBar
                size="lg"
                sessionId={activeSessionId}
                onSend={handleSend}
                status={chatStatus}
                onStop={handleStop}
                leftActions={
                  <ModeSelector
                    modes={thinkingModes}
                    value={thinkingLevel}
                    onChange={id => setThinkingLevel(toThinkingLevel(id))}
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
