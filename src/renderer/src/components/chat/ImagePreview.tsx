'use client';

import { useState, type SyntheticEvent } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { PreviewDialog } from '@/components/chat/PreviewDialog';
import { ZoomablePreviewArea } from '@/components/chat/markdown/ZoomablePreviewArea';
import { cn } from '@/lib/utils';

export type ImagePreviewDialogProps = {
  /** 待预览图片的 app:// 地址；为 null 表示关闭 */
  src: string | null;
  /** 弹窗开关变化回调，关闭时调用方应把 src 置空 */
  onOpenChange: (open: boolean) => void;
};

/** 图片加载状态。 */
type ImageLoadState = {
  status: 'loading' | 'ready' | 'error';
  width?: number;
  height?: number;
};

/**
 * 图片查看器：深色全屏浮层 + 缩放画布。
 *
 * 图片尺寸在 onLoad 之后才能拿到，加载完成前按兜底比例占位，完成后由画布重新适配。
 */
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [loadState, setLoadState] = useState<ImageLoadState>({ status: 'loading' });

  /**
   * 记录图片真实尺寸，供画布计算适应比例。
   */
  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;

    setLoadState({
      status: 'ready',
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    });
  }

  return (
    <>
      <ZoomablePreviewArea
        fill
        transparent
        wheelZoom="always"
        maxFit={1}
        inset={48}
        contentWidth={loadState.width}
        contentHeight={loadState.height}
        onClose={onClose}
        dismissOnBackdrop
      >
        <img
          src={src}
          alt="图片预览"
          draggable={false}
          className={cn(
            'h-full w-full object-contain',
            // 加载失败时浏览器会在原地画一个破图图标，盖住它，只留错误提示
            loadState.status === 'error' && 'invisible'
          )}
          onLoad={handleLoad}
          onError={() => setLoadState({ status: 'error' })}
        />
      </ZoomablePreviewArea>

      {loadState.status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs text-ink-secondary shadow-panel">
            <Loader2 className="size-3.5 animate-spin" />
            加载中
          </span>
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs text-destructive shadow-panel">
            <TriangleAlert className="size-3.5" />
            图片加载失败
          </span>
        </div>
      )}
    </>
  );
}

/**
 * 图片预览弹窗：受控组件，输入框草稿与已发送的气泡共用。
 *
 * 打开后是可缩放的查看器，图片不自动放大；滚轮以光标为锚点，拖动钳制在留白内，
 * 关闭键与缩放控件同在底部工具条，避开窗口右上角的窗口控件。
 */
export function ImagePreviewDialog({ src, onOpenChange }: ImagePreviewDialogProps) {
  /** 关闭瞬间记下的图片地址：调用方会立刻把 src 置空，退场动画期间仍要显示这张图 */
  const [closingSrc, setClosingSrc] = useState<string | null>(null);

  /** 关闭时先留住当前图片，再交给调用方清空 src */
  const handleOpenChange = (open: boolean): void => {
    setClosingSrc(open ? null : src);
    onOpenChange(open);
  };

  // 有 src 时用 src，关闭后回落到留住的那张，避免退场时只剩遮罩和关闭按钮
  const shownSrc = src ?? closingSrc;

  return (
    <PreviewDialog open={Boolean(src)} onOpenChange={handleOpenChange} title="图片预览">
      {shownSrc && <ImageViewer src={shownSrc} onClose={() => handleOpenChange(false)} />}
    </PreviewDialog>
  );
}
