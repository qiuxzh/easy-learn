import { useRef, useState } from 'react';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type CopyButtonProps = {
  text: string;
  onCopied?: () => void;
};

function CopyButton({ text, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
    onCopied?.();
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={handleCopy}
      onPointerDown={event => {
        event.stopPropagation();
      }}
      onMouseDown={event => event.stopPropagation()}
      className={cn(
        'size-6 flex items-center justify-center rounded-md active:scale-[0.97] transition-[background-color,opacity,transform] duration-150 ease-out',
        'opacity-50 bg-transparent hover:opacity-100 hover:bg-foreground/10'
      )}
    >
      <div className="relative w-3.5 h-3.5">
        <IconCopy
          className={cn(
            'absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
            copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
          )}
        />
        <IconCheck
          className={cn(
            'absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
            copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
          )}
        />
      </div>
    </button>
  );
}

export type MessageToolbarProps = {
  text?: string;
  timestamp?: string;
  heightClass: string;
  hoverClass: string;
  isVisible: boolean;
  alignClass: string;
  onCopied?: () => void;
};

/**
 * 单条消息下方的操作栏：复制按钮 + 时间戳。
 * 复制按钮默认可见，isVisible 用于复制成功后的高亮状态。
 */
export function MessageToolbar({
  text,
  timestamp,
  heightClass,
  hoverClass,
  isVisible,
  alignClass,
  onCopied,
}: MessageToolbarProps) {
  return (
    <div
      role="presentation"
      className={cn(
        'flex items-center gap-1 pt-1 text-xs text-muted-foreground/70 transition-colors duration-100',
        heightClass,
        alignClass,
        hoverClass,
        isVisible && 'text-foreground/80'
      )}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      {timestamp && <span>{timestamp}</span>}
      {text && <CopyButton text={text} onCopied={onCopied} />}
    </div>
  );
}

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

export function formatTimestamp(date: Date): string {
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return timeFormatter.format(date);
  }
  return dateFormatter.format(date);
}
