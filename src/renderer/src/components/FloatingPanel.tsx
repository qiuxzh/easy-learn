import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 浮层的位置与尺寸，单位均为像素。 */
interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 尺寸下限与上限。 */
const MIN_WIDTH = 320;
const MIN_HEIGHT = 280;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;

/** 默认尺寸。 */
const DEFAULT_SIZE = { width: 420, height: 560 };

/** 距容器边缘的留白。 */
const EDGE_GAP = 8;

/** 可拖拽的边与角。 */
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** 边到光标的映射。 */
const EDGE_CURSOR: Record<ResizeEdge, string> = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
};

/** 把像素值夹在上下限之间。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

/** 浮层属性。 */
interface FloatingPanelProps {
  /** 是否可见；不可见时仅隐藏，组件本身不卸载以保留内部状态。 */
  open: boolean;
  /** 点击关闭按钮的回调。 */
  onClose: () => void;
  /** 标题，显示在浮层顶部，同时是拖动窗口的把手。 */
  title?: string;
  /** 浮层内容。 */
  children: ReactNode;
  /** localStorage 键名，用于记住上次的位置与尺寸。 */
  storageKey: string;
  /** 初始尺寸，未读过缓存时使用。 */
  defaultSize?: { width: number; height: number };
  /** 附在浮层根节点的 class。 */
  className?: string;
}

/**
 * 可自由移动与缩放的浮层。
 *
 * 交互对齐原生窗口：鼠标移到任意边或角都改变光标并可缩放，按住标题栏可移动整个窗口。
 * 位置与尺寸都用像素记录，拖动过程中只写内存，松手时才落盘，避免每帧写
 * localStorage 造成掉帧。
 */
export function FloatingPanel({
  open,
  onClose,
  title,
  children,
  storageKey,
  defaultSize = DEFAULT_SIZE,
  className,
}: FloatingPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** 未指定位置时，首次布局按右下角对齐；之后由用户拖动决定。 */
  const [rect, setRect] = useState<PanelRect | null>(() => readStoredRect(storageKey));
  /** 容器可用尺寸，用于把浮层限制在可视区域内。 */
  const containerRef = useRef({ width: 0, height: 0 });
  /** 是否需要按右下角做首次定位。 */
  const needsInitialPlacement = useRef(rect === null);

  /** 测量可用区域：浮层挂在 body 上，以视口为界。 */
  const measure = useCallback(() => {
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (width <= 0 || height <= 0) return;
    containerRef.current = { width, height };
  }, []);

  // 首次打开时按右下角定位；容器尺寸变化时把浮层拉回可视范围
  useEffect(() => {
    if (!open) return;

    measure();
    const { width: cw, height: ch } = containerRef.current;

    setRect(current => {
      if (current && !needsInitialPlacement.current) {
        return fitRect(current, cw, ch);
      }
      needsInitialPlacement.current = false;
      const base = current ?? { ...defaultSize, x: 0, y: 0 };
      return fitRect(
        { ...base, x: cw - base.width - EDGE_GAP, y: ch - base.height - EDGE_GAP },
        cw,
        ch
      );
    });

    const handleResize = () => {
      measure();
      const { width, height } = containerRef.current;
      setRect(current => (current ? fitRect(current, width, height) : current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open, measure, defaultSize]);

  /** 缩放：按住边或角拖动，改变宽高并按方向移动左上角。 */
  function handleResizeStart(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!rect) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const start = rect;

    /** 按拖动的边决定宽高如何变化。 */
    function handleMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      let { x, y, width, height } = start;
      // 向右拖动右边缘 -> 变宽；向左拖动左边缘 -> 变宽且左边界左移
      if (edge.includes('e')) width = clamp(start.width + dx, MIN_WIDTH, MAX_WIDTH);
      if (edge.includes('w')) {
        width = clamp(start.width - dx, MIN_WIDTH, MAX_WIDTH);
        x = start.x + (start.width - width);
      }
      if (edge.includes('s')) height = clamp(start.height + dy, MIN_HEIGHT, MAX_HEIGHT);
      if (edge.includes('n')) {
        height = clamp(start.height - dy, MIN_HEIGHT, MAX_HEIGHT);
        y = start.y + (start.height - height);
      }
      setRect({ x, y, width, height });
    }

    finishDrag(handleMove, () => {
      setRect(current => {
        if (!current) return current;
        const { width, height } = containerRef.current;
        const fitted = fitRect(current, width, height);
        writeStoredRect(storageKey, fitted);
        return fitted;
      });
    });
  }

  /** 移动：按住标题栏拖动整个窗口。 */
  function handleMoveStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!rect) return;
    // 点在标题栏里的按钮（如关闭）上时不拖动
    if ((event.target as HTMLElement).closest('button')) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const start = rect;

    function handleMove(moveEvent: PointerEvent) {
      const { width: cw, height: ch } = containerRef.current;
      const nextX = start.x + (moveEvent.clientX - startX);
      const nextY = start.y + (moveEvent.clientY - startY);
      setRect({
        ...start,
        // 移动时允许贴边，但不能完全移出可视区域
        x: clamp(nextX, -start.width + 80, cw - 80),
        y: clamp(nextY, 0, ch - 32),
      });
    }

    finishDrag(handleMove, () => {
      setRect(current => {
        if (!current) return current;
        const { width, height } = containerRef.current;
        const fitted = fitRect(current, width, height);
        writeStoredRect(storageKey, fitted);
        return fitted;
      });
    });
  }

  /** 统一的拖动收尾：摘下 window 监听并执行落盘逻辑。 */
  function finishDrag(onMove: (event: PointerEvent) => void, onDone: () => void) {
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      onDone();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
  }

  /** 未完成首次定位前先按默认尺寸占位，避免闪一下。 */
  const style = rect
    ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
    : {
        right: EDGE_GAP,
        bottom: EDGE_GAP,
        width: defaultSize.width,
        height: defaultSize.height,
      };

  return createPortal(
    <div
      ref={rootRef}
      data-floating-panel
      role="dialog"
      aria-label={title}
      aria-hidden={!open}
      style={style}
      className={cn(
        // 常驻浮层用 z-panel，低于临时弹层的 z-popover
        'fixed z-panel flex flex-col rounded-xl border border-border bg-background shadow-xl',
        !open && 'invisible opacity-0',
        className
      )}
    >
      {/* 标题栏：按住可移动窗口 */}
      <div
        data-floating-panel-drag-handle
        onPointerDown={handleMoveStart}
        className="flex shrink-0 cursor-move touch-none items-center justify-between gap-2 rounded-t-xl border-b border-border bg-muted/40 px-3 py-1.5 select-none"
      >
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          title="关闭"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* 内容区禁止溢出，圆角由外层的裁剪承担 */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-xl">{children}</div>

      {/* 八向缩放手柄：每条边与每个角各一个，悬停改变光标 */}
      {(Object.keys(EDGE_CURSOR) as ResizeEdge[]).map(edge => (
        <div
          key={edge}
          data-floating-panel-resize-handle={edge}
          aria-hidden="true"
          onPointerDown={event => handleResizeStart(edge, event)}
          className={cn('absolute touch-none select-none', EDGE_CURSOR[edge], EDGE_STYLE[edge])}
        />
      ))}

      {/* 右下角斜纹提示，仅作视觉暗示，不参与命中 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1 bottom-1 size-2.5 border-r-2 border-b-2 border-muted-foreground/50"
      />
    </div>,
    document.body
  );
}

/**
 * 各条边的定位与命中尺寸。
 * 边为 6px 厚、角为 14px 见方：既要容易命中，又不能压住内容区的交互。
 */
const EDGE_STYLE: Record<ResizeEdge, string> = {
  n: `left-3.5 right-3.5 top-0 z-10 h-1.5`,
  s: `left-3.5 right-3.5 bottom-0 z-10 h-1.5`,
  e: `top-3.5 bottom-3.5 right-0 z-10 w-1.5`,
  w: `top-3.5 bottom-3.5 left-0 z-10 w-1.5`,
  ne: `right-0 top-0 z-20 size-3.5`,
  nw: `left-0 top-0 z-20 size-3.5`,
  se: `right-0 bottom-0 z-20 size-3.5`,
  sw: `left-0 bottom-0 z-20 size-3.5`,
};

/** 把浮层收回容器可视范围内，并夹取尺寸上下限。 */
function fitRect(rect: PanelRect, containerWidth: number, containerHeight: number): PanelRect {
  const maxWidth =
    containerWidth > 0 ? Math.min(MAX_WIDTH, containerWidth - EDGE_GAP * 2) : MAX_WIDTH;
  const maxHeight =
    containerHeight > 0 ? Math.min(MAX_HEIGHT, containerHeight - EDGE_GAP * 2) : MAX_HEIGHT;
  const width = clamp(rect.width, MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, MIN_HEIGHT, maxHeight);
  const maxX = containerWidth > 0 ? containerWidth - width : rect.x;
  const maxY = containerHeight > 0 ? containerHeight - height : rect.y;
  return {
    width,
    height,
    x: clamp(rect.x, 0, Math.max(0, maxX)),
    y: clamp(rect.y, 0, Math.max(0, maxY)),
  };
}

/** 从 localStorage 读取上次的位置与尺寸；无效时返回 null。 */
function readStoredRect(storageKey: string): PanelRect | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { x, y, width, height } = parsed as Partial<PanelRect>;
    for (const value of [x, y, width, height]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    }
    return {
      x: x as number,
      y: y as number,
      width: clamp(width as number, MIN_WIDTH, MAX_WIDTH),
      height: clamp(height as number, MIN_HEIGHT, MAX_HEIGHT),
    };
  } catch {
    return null;
  }
}

/** 把位置与尺寸写入 localStorage；不可用时静默忽略。 */
function writeStoredRect(storageKey: string, rect: PanelRect): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(rect));
  } catch {
    /* ignore */
  }
}
