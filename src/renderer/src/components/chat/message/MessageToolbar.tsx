import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';
import { Check, Code, Copy, GitBranch } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';

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
    <IconButton
      type="button"
      label={copied ? '已复制' : '复制'}
      tabIndex={-1}
      onClick={handleCopy}
      onPointerDown={event => {
        event.stopPropagation();
      }}
      onMouseDown={event => event.stopPropagation()}
      className="opacity-50 transition-opacity hover:opacity-100 active:scale-[0.97]"
    >
      <div className="relative w-3.5 h-3.5">
        <Copy
          className={cn(
            'absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
            copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
          )}
        />
        <Check
          className={cn(
            'absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
            copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
          )}
        />
      </div>
    </IconButton>
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
  /** 当前回复是否按原始 Markdown 展示 */
  rawMode?: boolean;
  /** 提供时渲染原文/渲染切换按钮 */
  onToggleRaw?: () => void;
  /** 提供时渲染分支按钮：把会话从这条回复之后切成一个新会话 */
  onFork?: () => void;
};

function RawToggleButton({ rawMode, onToggle }: { rawMode: boolean; onToggle: () => void }) {
  return (
    <IconButton
      type="button"
      label={rawMode ? '查看渲染结果' : '查看原文'}
      aria-pressed={rawMode}
      pressed={rawMode}
      tabIndex={-1}
      onClick={onToggle}
      onPointerDown={event => {
        event.stopPropagation();
      }}
      onMouseDown={event => event.stopPropagation()}
      className={cn(
        'transition-opacity active:scale-[0.97]',
        rawMode ? 'opacity-100' : 'opacity-50 hover:opacity-100'
      )}
    >
      <Code className="text-muted-foreground" />
    </IconButton>
  );
}

/** 从这条回复分出新会话。 */
function ForkButton({ onFork }: { onFork: () => void }) {
  return (
    <IconButton
      type="button"
      label="从这条回复分支出新会话"
      tabIndex={-1}
      onClick={onFork}
      onPointerDown={event => {
        event.stopPropagation();
      }}
      onMouseDown={event => event.stopPropagation()}
      className="opacity-50 transition-opacity hover:opacity-100 active:scale-[0.97]"
    >
      <GitBranch className="text-muted-foreground" />
    </IconButton>
  );
}

/**
 * 单条消息下方的操作栏。
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
  rawMode,
  onToggleRaw,
  onFork,
}: MessageToolbarProps) {
  return (
    <div
      role="presentation"
      className={cn(
        'flex items-center gap-1 pt-1 text-xs text-ink-secondary transition-colors duration-100',
        heightClass,
        alignClass,
        hoverClass,
        isVisible && 'text-ink-secondary'
      )}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      {timestamp && <span>{timestamp}</span>}
      {text && <CopyButton text={text} onCopied={onCopied} />}
      {text && onToggleRaw && <RawToggleButton rawMode={rawMode ?? false} onToggle={onToggleRaw} />}
      {onFork && <ForkButton onFork={onFork} />}
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
