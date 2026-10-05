import React from 'react';
import { cn } from '@/lib/utils';

export type TextShimmerProps = {
  children: React.ReactNode;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  delay?: number;
};

/**
 * 流光文字：在 muted → foreground → muted 之间循环渐变扫光。
 * 颜色与动画由 chat.css 的 .chat-shimmer 规则统一控制。
 */
function TextShimmerComponent({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  delay = 0,
}: TextShimmerProps) {
  const style: React.CSSProperties = {
    ['--chat-shimmer-duration' as string]: `${duration}s`,
    ...(delay > 0 ? { animationDelay: `${delay}s` } : {}),
  };

  return (
    <Component className={cn('chat-shimmer', className)} style={style}>
      {children}
    </Component>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
