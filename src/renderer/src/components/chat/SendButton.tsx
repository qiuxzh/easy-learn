import { cn } from '@/lib/utils';
import { ArrowUp, Square } from 'lucide-react';

export type SendButtonProps = {
  state: 'idle' | 'typing' | 'streaming';
};

/**
 * 输入框右侧的发送 / 停止按钮：
 * - streaming：实心圆 + 停止图标，点击触发 onStop
 * - typing（有待发内容）：蓝色圆 + 上箭头
 * - idle（无内容）：灰色圆，禁用态
 */
export function SendButton({ state }: SendButtonProps) {
  const isStreaming = state === 'streaming';
  const isTyping = state === 'typing';

  if (isStreaming) {
    return (
      <div className="size-7 rounded-full bg-foreground flex items-center justify-center cursor-pointer">
        <Square className="size-4 text-background" fill="currentColor" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'size-7 rounded-full flex items-center justify-center',
        isTyping ? 'bg-primary cursor-pointer' : 'bg-muted cursor-default'
      )}
    >
      <ArrowUp
        className={cn('size-4', isTyping ? 'text-primary-foreground' : 'text-muted-foreground')}
      />
    </div>
  );
}
