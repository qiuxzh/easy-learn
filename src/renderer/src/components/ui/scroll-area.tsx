import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as React from 'react';
import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    scrollBarClassName?: string;
    showHorizontalScrollBar?: boolean;
  }
>(({ className, children, scrollBarClassName, showHorizontalScrollBar = false, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative flex flex-col overflow-hidden', className)}
    {...props}
  >
    {/* 视口用 flex-1 而不是 h-full：Root 的高度常常来自 flex 或 max-height，不是确定值，百分比高度解析不到会让视口长到内容高度、滚不动 */}
    <ScrollAreaPrimitive.Viewport className="min-h-0 w-full flex-1 rounded-[inherit] overflow-hidden">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar className={scrollBarClassName} />
    {showHorizontalScrollBar && <ScrollBar orientation="horizontal" />}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-[var(--scrollbar-size)] p-[1px]',
      orientation === 'horizontal' &&
        'h-[var(--scrollbar-size)] flex-col border-t border-t-transparent p-[1px]',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="scrollbar-thumb relative flex-1 rounded-full" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
