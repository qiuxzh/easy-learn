import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/** 默认预览视口高度。 */
export const DEFAULT_PREVIEW_HEIGHT = 320;

/** 拖拽状态。 */
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
};

/** 预览视口尺寸。 */
type ViewportSize = {
  width: number;
  height: number;
};

/** 可缩放预览属性。 */
type ZoomablePreviewProps = {
  children: ReactNode;
  contentWidth?: number;
  contentHeight?: number;
  viewportHeight?: number;
  className?: string;
  contentClassName?: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const WHEEL_ZOOM_FACTOR = 1.1;

/**
 * 计算内容完整显示在视口内所需的基准缩放。
 *
 * 取宽高两个方向比例中的较小值，因此内容必定完整可见（contain 语义）；
 * 内容小于视口时同样放大填满。内容尺寸或视口尺寸未知、视口不可见（尺寸为 0）时
 * 返回 1，即按原始尺寸显示，避免内容被缩放为 0。
 */
function resolveFitScale(
  viewportSize: ViewportSize | null,
  contentWidth?: number,
  contentHeight?: number
): number {
  if (
    !viewportSize ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0 ||
    !contentWidth ||
    !contentHeight
  ) {
    return 1;
  }

  return Math.min(viewportSize.width / contentWidth, viewportSize.height / contentHeight);
}

/**
 * 提供滚轮缩放、鼠标拖动和双击重置的通用预览容器。
 *
 * 内容默认按视口自适应（完整可见），滚轮缩放是在自适应比例之上的倍率。
 */
export function ZoomablePreview({
  children,
  contentWidth,
  contentHeight,
  viewportHeight = DEFAULT_PREVIEW_HEIGHT,
  className,
  contentClassName,
}: ZoomablePreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState<ViewportSize | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  // 跟踪视口尺寸，作为内容自适应缩放的基准
  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY) {
        return;
      }

      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      setZoom(current => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)));
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const fitScale = resolveFitScale(viewportSize, contentWidth, contentHeight);
  // 内容尺寸已知但视口尚未测量时先隐藏，避免按原始尺寸绘制一帧后再跳变
  const isFitReady = !contentWidth || !contentHeight || viewportSize !== null;

  /**
   * 开始拖动预览内容。
   */
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  }

  /**
   * 根据指针位移更新预览位置。
   */
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setPan({
      x: dragState.startPanX + event.clientX - dragState.startX,
      y: dragState.startPanY + event.clientY - dragState.startY,
    });
  }

  /**
   * 结束拖动并释放指针捕获。
   */
  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
  }

  /**
   * 重置缩放和拖动位置。
   */
  function resetPreview() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative cursor-grab select-none overflow-hidden bg-background active:cursor-grabbing',
        className
      )}
      style={{ height: viewportHeight }}
      title="滚轮缩放，拖动查看，双击重置"
      onDoubleClick={resetPreview}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragStart={event => event.preventDefault()}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        <div
          className={cn('origin-center', contentClassName)}
          style={{
            width: contentWidth,
            height: contentHeight,
            transform: `scale(${fitScale * zoom})`,
            visibility: isFitReady ? undefined : 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
