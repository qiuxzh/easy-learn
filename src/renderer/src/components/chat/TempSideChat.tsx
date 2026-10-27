import { memo, useEffect } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { InputBar } from '@/components/chat/InputBar';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { useChat } from '@/hooks/use-chat';

/**
 * 临时会话面板：chat 页右侧弹出的临时会话，不绑书、不进会话列表。
 *
 * 关闭即销毁：卸载时 useChat 会删除库中的会话与 entry，所以本组件不能被常驻挂载，
 * 只能由调用方在展开时才渲染。
 */
export const TempSideChat = memo(function TempSideChat({ onClose }: { onClose: () => void }) {
  const session = useChat({ ephemeral: true });

  // Esc 关闭，但输入框里按 Esc 只是放弃输入，不能顺手销毁整个会话
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke-3 px-2">
        <span className="min-w-0 flex-1 truncate text-body font-semibold">临时会话</span>
        <IconButton label="关闭临时会话" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <ChatMessages session={session} variant="general" forkable={false} />
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
