import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

/** 默认预览视口高度。 */
export const DEFAULT_PREVIEW_HEIGHT = 320;

/** 内容尺寸缺失时的兜底比例：真实尺寸到位前只影响首帧适配。 */
const FALLBACK_CONTENT_WIDTH = 640;
const FALLBACK_CONTENT_HEIGHT = 320;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
/** 判定「是否处于适应态」的容差：滚轮缩放后倍率是浮点数。 */
const FIT_EPSILON = 0.001;
/** 区分点击与拖动的总位移阈值。 */
const DRAG_CLICK_TOLERANCE = 4;

/** 画布视口尺寸。 */
type ViewportSize = {
  width: number;
  height: number;
};

/** 内容原始尺寸。 */
type ContentSize = {
  width: number;
  height: number;
};

/** 缩放与平移：zoom 以「适应」为 100%，pan 为屏幕像素。 */
type ViewState = {
  zoom: number;
  panX: number;
  panY: number;
};

/** 拖动中的指针基线。 */
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
};

/** 可缩放预览属性。 */
type ZoomablePreviewAreaProps = {
  children: ReactNode;
  contentWidth?: number;
  contentHeight?: number;
  viewportHeight?: number;
  /** 撑满最近的定位父级，全屏浮层用 */
  fill?: boolean;
  /** 滚轮缩放策略：modifier 只认 Ctrl/⌘，always 直接缩放（全屏浮层用） */
  wheelZoom?: 'modifier' | 'always';
  /** 适应比例上限：图片等栅格内容传 1，避免自动放大变糊；不传则不封顶 */
  maxFit?: number;
  /** 视口四周的留白：适应比例与平移边界都扣除它 */
  inset?: number;
  /** 透明底：放在深色遮罩上时用，避免画布底色盖住遮罩 */
  transparent?: boolean;
  /** 内容底板：给图表内容铺上主题底色，避免浅色图表直接落在深色遮罩上 */
  contentBackground?: 'none' | 'theme';
  /** 传入后显示右上角放大按钮 */
  onExpand?: () => void;
  expandLabel?: string;
  /** 传入后工具条末尾显示关闭按钮 */
  onClose?: () => void;
  /** 点击空白区域关闭；拖动结束后的那一次点击会被忽略 */
  dismissOnBackdrop?: boolean;
  className?: string;
};

/**
 * 把内容尺寸补齐为正数；缺失或非法时退回兜底比例。
 */
function normalizeContentSize(width?: number, height?: number): ContentSize {
  return {
    width: width && width > 0 ? width : FALLBACK_CONTENT_WIDTH,
    height: height && height > 0 ? height : FALLBACK_CONTENT_HEIGHT,
  };
}

/**
 * 计算扣除四周留白后可用于摆放松缩内容的尺寸。
 */
function resolveAvailableSize(viewport: ViewportSize | null, inset: number): ViewportSize | null {
  if (!viewport) {
    return null;
  }

  return {
    width: Math.max(0, viewport.width - inset * 2),
    height: Math.max(0, viewport.height - inset * 2),
  };
}

/**
 * 计算内容完整显示所需的基准缩放。
 *
 * 取宽高两个方向的较小比例，内容必定完整可见；内容小于可用空间时同样放大填满。
 * maxFit 给栅格内容兜底（图片放大只会变糊），inset 用于预留四周安全边距。
 * 视口尚未测量时返回 1，避免内容按 0 缩放而不可见。
 */
function resolveFitScale(
  viewport: ViewportSize | null,
  content: ContentSize,
  maxFit: number,
  inset: number
): number {
  const available = resolveAvailableSize(viewport, inset);

  if (!available || available.width <= 0 || available.height <= 0) {
    return 1;
  }

  return Math.min(available.width / content.width, available.height / content.height, maxFit);
}

/**
 * 最小缩放倍率。
 *
 * 内容极小时「1:1」会低于固定下限，下限随 fit 一起放宽，保证原始尺寸始终可达。
 */
function resolveMinZoom(fit: number): number {
  return Math.min(MIN_ZOOM, 1 / fit);
}

/**
 * 把缩放倍率与平移限制在可视范围内。
 *
 * 内容小于可用区域时平移量归零，内容因此始终居中；内容放大后最多移动到内容边缘与可用区域边缘对齐，
 * 不会出现把图表拖出视野后只能靠复位找回的情况。
 */
function limitView(
  view: ViewState,
  fit: number,
  content: ContentSize,
  available: ViewportSize | null
): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(resolveMinZoom(fit), view.zoom));
  const scale = fit * zoom;
  const limitX = available ? Math.max(0, (content.width * scale - available.width) / 2) : 0;
  const limitY = available ? Math.max(0, (content.height * scale - available.height) / 2) : 0;

  return {
    zoom,
    panX: Math.min(limitX, Math.max(-limitX, view.panX)),
    panY: Math.min(limitY, Math.max(-limitY, view.panY)),
  };
}

/**
 * 提供缩放、平移与关闭入口的预览画布。
 *
 * 缩放倍率以「适应」为 100%；内联时滚轮只在按住 Ctrl/⌘ 时缩放，其余情况留给页面滚动，
 * 鼠标停在内容上不会把聊天卡住。内容尺寸变化或视口缩放后，越界的平移在渲染时收紧。
 */
export function ZoomablePreviewArea({
  children,
  contentWidth,
  contentHeight,
  viewportHeight = DEFAULT_PREVIEW_HEIGHT,
  fill = false,
  wheelZoom = 'modifier',
  maxFit = Number.POSITIVE_INFINITY,
  inset = 0,
  transparent = false,
  contentBackground = 'none',
  onExpand,
  expandLabel = '放大预览',
  onClose,
  dismissOnBackdrop = false,
  className,
}: ZoomablePreviewAreaProps) {
  const content = useMemo(
    () => normalizeContentSize(contentWidth, contentHeight),
    [contentWidth, contentHeight]
  );
  const [viewport, setViewport] = useState<ViewportSize | null>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragMovedRef = useRef(false);
  const pressOnBackdropRef = useRef(false);

  const fit = resolveFitScale(viewport, content, maxFit, inset);
  const minZoom = resolveMinZoom(fit);
  const available = useMemo(() => resolveAvailableSize(viewport, inset), [viewport, inset]);
  const shownView = limitView(view, fit, content, available);
  const scale = fit * shownView.zoom;
  const isFitted = Math.abs(shownView.zoom - 1) < FIT_EPSILON;
  const canPan =
    available !== null &&
    (content.width * scale - available.width > 1 || content.height * scale - available.height > 1);

  // 用 ResizeObserver 的 contentRect 而不是 getBoundingClientRect：浮层入场动画带缩放，后者会量到动画中的尺寸
  useEffect(() => {
    const element = viewportRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;

      // 隐藏状态（如源码模式）下尺寸为 0，保留上一次的有效尺寸，重新可见时会再触发一次
      if (width <= 0 || height <= 0) {
        return;
      }

      setViewport({ width, height });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;

    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY) {
        return;
      }

      // 内联时普通滚轮留给页面，避免鼠标停在图表上滚不动聊天；全屏浮层里页面本就不滚动，直接缩放
      if (wheelZoom === 'modifier' && !event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);

      setView(current => {
        const base = limitView(current, fit, content, available);
        const nextZoom = Math.min(MAX_ZOOM, Math.max(minZoom, base.zoom * factor));
        const currentScale = fit * base.zoom;
        const nextScale = fit * nextZoom;

        if (currentScale <= 0) {
          return base;
        }

        // 以光标为锚点：保持光标下的内容点不动，避免缩放后目标节点跑到视野外
        const pointX = (anchor.x - base.panX) / currentScale;
        const pointY = (anchor.y - base.panY) / currentScale;

        return limitView(
          {
            zoom: nextZoom,
            panX: anchor.x - pointX * nextScale,
            panY: anchor.y - pointY * nextScale,
          },
          fit,
          content,
          available
        );
      });
    };

    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [available, content, fit, minZoom, wheelZoom]);

  /**
   * 开始拖动；内容没有超出可用区域时平移本就无效，直接跳过以免捕获指针。
   */
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    dragMovedRef.current = false;
    pressOnBackdropRef.current = event.target === event.currentTarget;

    if (!canPan) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: shownView.panX,
      panY: shownView.panY,
    };
  }

  /**
   * 按指针位移更新平移；每次写入都先收紧，越界量不会累积到状态里。
   */
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const nextPanX = drag.panX + event.clientX - drag.startX;
    const nextPanY = drag.panY + event.clientY - drag.startY;

    if (
      Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) >
      DRAG_CLICK_TOLERANCE
    ) {
      dragMovedRef.current = true;
    }

    setView(current =>
      limitView({ ...current, panX: nextPanX, panY: nextPanY }, fit, content, available)
    );
  }

  /**
   * 结束拖动并释放指针捕获；空白处的原地抬起按关闭处理。
   */
  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;

    if (drag && drag.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      dragRef.current = null;
    }

    const shouldDismiss =
      event.type === 'pointerup' &&
      dismissOnBackdrop &&
      pressOnBackdropRef.current &&
      !dragMovedRef.current &&
      event.target === event.currentTarget;

    pressOnBackdropRef.current = false;

    if (shouldDismiss) {
      onClose?.();
    }
  }

  /**
   * 以视口中心为锚点放大或缩小。
   */
  function adjustZoom(multiplier: number) {
    setView(current => {
      const base = limitView(current, fit, content, available);

      return limitView({ ...base, zoom: base.zoom * multiplier }, fit, content, available);
    });
  }

  /**
   * 回到适应状态：倍率 100%、内容居中。
   */
  function resetToFit() {
    setView(current =>
      limitView({ ...current, zoom: 1, panX: 0, panY: 0 }, fit, content, available)
    );
  }

  /**
   * 回到内容原始尺寸；内容远大于可用区域时会被最大倍率截断，此时视口内仍是放大后的局部。
   */
  function resetToActualSize() {
    setView(current =>
      limitView({ ...current, zoom: 1 / fit, panX: 0, panY: 0 }, fit, content, available)
    );
  }

  /**
   * 双击在「适应」与「1:1」之间切换。
   */
  function handleDoubleClick() {
    setView(current => {
      const base = limitView(current, fit, content, available);
      const nextZoom = Math.abs(base.zoom - 1) < FIT_EPSILON ? 1 / fit : 1;

      return limitView({ zoom: nextZoom, panX: 0, panY: 0 }, fit, content, available);
    });
  }

  return (
    <div
      className={cn(
        'group/preview overflow-hidden select-none',
        transparent ? 'bg-transparent' : 'bg-background',
        fill ? 'absolute inset-0' : 'relative',
        canPan && 'cursor-grab active:cursor-grabbing',
        className
      )}
      style={fill ? undefined : { height: viewportHeight }}
    >
      <div
        ref={viewportRef}
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onDragStart={event => event.preventDefault()}
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate(-50%, -50%) translate(${shownView.panX}px, ${shownView.panY}px)`,
          }}
        >
          <div
            className={cn('origin-center', contentBackground === 'theme' && 'bg-background')}
            style={{
              width: content.width,
              height: content.height,
              transform: `scale(${scale})`,
              visibility: viewport ? undefined : 'hidden',
            }}
          >
            {children}
          </div>
        </div>
      </div>

      {onExpand && (
        <IconButton
          variant="floating"
          size="sm"
          label={expandLabel}
          onClick={onExpand}
          className="absolute top-2 right-2 z-10 rounded-full"
        >
          <Maximize2 />
        </IconButton>
      )}

      {/* 控件只压在画布上，不参与内容布局；内联在适应态下淡出，全屏（带关闭键）则常显，否则关闭入口会藏起来 */}
      <div
        className={cn(
          'absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-card p-0.5 shadow-panel transition-opacity',
          isFitted && !onClose
            ? 'pointer-events-none opacity-0 group-hover/preview:pointer-events-auto group-hover/preview:opacity-100 group-focus-within/preview:pointer-events-auto group-focus-within/preview:opacity-100'
            : 'opacity-100'
        )}
        role="toolbar"
        aria-label="预览工具"
      >
        <IconButton
          size="xs"
          label="缩小"
          disabled={shownView.zoom <= minZoom}
          onClick={() => adjustZoom(1 / ZOOM_STEP)}
        >
          <Minus />
        </IconButton>
        <span className="min-w-9 text-center text-xs tabular-nums text-ink-secondary">
          {Math.round(shownView.zoom * 100)}%
        </span>
        <IconButton
          size="xs"
          label="放大"
          disabled={shownView.zoom >= MAX_ZOOM}
          onClick={() => adjustZoom(ZOOM_STEP)}
        >
          <Plus />
        </IconButton>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-stroke-4" />
        <Button variant="ghost" size="xs" onClick={resetToFit}>
          适应
        </Button>
        <Button variant="ghost" size="xs" onClick={resetToActualSize}>
          1:1
        </Button>
        {onClose && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-stroke-4" />
            <IconButton size="xs" label="关闭预览" onClick={onClose}>
              <X />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
