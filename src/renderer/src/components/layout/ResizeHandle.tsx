import { cn } from '@/lib/utils';
import type { PanelResizeHandler } from '@/hooks/use-panel-width';

interface ResizeHandleProps {
  /** 可访问名，说明这条分隔条调整的是哪个面板 */
  label: string;
  /** 由 usePanelWidth 提供的拖拽起点 */
  onResize: PanelResizeHandler;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/**
 * 分栏之间的可拖拽分隔条。
 *
 * 平时就显出一条细线：完全透明的分隔条没人会想到能拖，命中区只有 6px，靠鼠标形状碰运气。
 * 悬停时线变主色并浮出一枚抓点，把「这里可以拖」说清楚。
 *
 * 分隔线只由这里画。两侧面板不要再加相邻的 border，否则会在 6px 间距的两端各显一条，
 * 看起来是双线。
 */
export function ResizeHandle({
  label,
  onResize,
  orientation = 'vertical',
  className,
}: ResizeHandleProps) {
  const vertical = orientation === 'vertical';

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={onResize}
      className={cn(
        'group relative shrink-0',
        vertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute bg-stroke-3 transition-colors group-hover:bg-primary/50',
          vertical
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2'
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[2px] rounded-full bg-background opacity-0 shadow-sm ring-1 ring-stroke-3 transition-opacity group-hover:opacity-100',
          vertical ? 'h-7 w-[7px] flex-col' : 'h-[7px] w-7 flex-row'
        )}
      >
        <span className="h-[2px] w-[2px] rounded-full bg-ink-tertiary" />
        <span className="h-[2px] w-[2px] rounded-full bg-ink-tertiary" />
        <span className="h-[2px] w-[2px] rounded-full bg-ink-tertiary" />
      </span>
    </div>
  );
}
