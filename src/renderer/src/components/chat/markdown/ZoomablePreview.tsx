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
 * 提供滚轮缩放、鼠标拖动和双击重置的通用预览容器。
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

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
            transform: `scale(${zoom})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
