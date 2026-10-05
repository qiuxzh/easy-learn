import { useEffect, useState, type SyntheticEvent } from 'react';
import { Copy, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomRendererProps } from 'streamdown';
import { Button } from '@/components/ui/button';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import {
  DEFAULT_PREVIEW_HEIGHT,
  ZoomablePreview,
} from '@/components/chat/markdown/ZoomablePreview';
import {
  copySvgImageToClipboard,
  getSvgDimensions,
  validateSvgSource,
} from '@/components/chat/markdown/svg-utils';

/** SVG 代码块的显示模式。 */
type SvgViewMode = 'preview' | 'source';

/** SVG 预览加载状态。 */
type SvgPreviewState = {
  code: string;
  status: 'loading' | 'success' | 'error';
  width?: number;
  height?: number;
  error?: string;
};

const FALLBACK_CONTENT_WIDTH = 640;
const FALLBACK_CONTENT_HEIGHT = 320;

/**
 * 为当前 SVG 代码创建 Blob URL。
 */
function useSvgPreviewUrl(code: string, enabled: boolean): string | undefined {
  const [previewSource, setPreviewSource] = useState<{ code: string; url: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const url = URL.createObjectURL(new Blob([code], { type: 'image/svg+xml' }));
    const timer = window.setTimeout(() => setPreviewSource({ code, url }), 0);

    return () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [code, enabled]);

  return previewSource?.code === code ? previewSource.url : undefined;
}

/**
 * 支持源码、预览、缩放、拖动和复制的 SVG 代码块。
 */
export function SvgBlock({ code, isIncomplete, language }: CustomRendererProps) {
  const [viewMode, setViewMode] = useState<SvgViewMode>('preview');
  const [previewState, setPreviewState] = useState<SvgPreviewState>({
    code,
    status: 'loading',
  });
  const validationError = isIncomplete ? undefined : validateSvgSource(code); // 渲染期间认为是无错误的
  const previewUrl = useSvgPreviewUrl(code, !isIncomplete && !validationError);
  const sourceDimensions = validationError ? undefined : getSvgDimensions(code);
  const isPreviewCurrent = previewState.code === code;
  const previewStatus = isPreviewCurrent ? previewState.status : 'loading';
  const previewError =
    isPreviewCurrent && previewState.status === 'error' ? previewState.error : undefined;
  const contentWidth = previewState.width ?? sourceDimensions?.width ?? FALLBACK_CONTENT_WIDTH;
  const contentHeight = previewState.height ?? sourceDimensions?.height ?? FALLBACK_CONTENT_HEIGHT;

  /**
   * 记录 SVG 图片实际尺寸。
   */
  function handlePreviewLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;

    setPreviewState({
      code,
      status: 'success',
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    });
  }

  /**
   * 记录 SVG 图片加载失败。
   */
  function handlePreviewError() {
    setPreviewState({
      code,
      status: 'error',
      error: 'SVG 图片加载失败',
    });
  }

  /**
   * 复制 SVG 源码。
   */
  async function handleCopySource() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('已复制源码');
    } catch {
      toast.error('复制源码失败');
    }
  }

  /**
   * 复制 SVG 图片。
   */
  async function handleCopyImage() {
    if (validationError || isIncomplete) {
      return;
    }

    try {
      await copySvgImageToClipboard(code);
      toast.success('已复制图片');
    } catch {
      toast.error('复制图片失败');
    }
  }

  return (
    <div
      className="my-4 overflow-hidden rounded-xl border border-border bg-sidebar"
      data-streamdown="svg-block"
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-2 py-1">
        <span className="ml-1 font-mono text-xs lowercase text-muted-foreground">{language}</span>
        <div className="flex flex-wrap items-center gap-1">
          <SegmentedToggle
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'source', label: '源码' },
              { value: 'preview', label: '预览' },
            ]}
          />

          {viewMode === 'source' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 cursor-pointer w-7 p-0"
              title="复制源码"
              aria-label="复制源码"
              onClick={() => void handleCopySource()}
            >
              <Copy />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 cursor-pointer w-7 p-0"
              title="复制图片"
              aria-label="复制图片"
              disabled={Boolean(validationError) || isIncomplete}
              onClick={() => void handleCopyImage()}
            >
              <Copy />
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'source' ? (
        <pre
          className="m-0 overflow-auto bg-background p-4 text-sm leading-relaxed"
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <code>{code}</code>
        </pre>
      ) : isIncomplete ? (
        <div
          className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <Loader2 className="size-4 animate-spin" />
          SVG 代码生成中
        </div>
      ) : validationError ? (
        <SvgError message={validationError} />
      ) : previewStatus === 'error' ? (
        <SvgError message={previewError ?? 'SVG 图片加载失败'} />
      ) : (
        <div className="relative">
          {previewUrl && (
            <ZoomablePreview
              contentWidth={contentWidth}
              contentHeight={contentHeight}
              className="bg-background"
            >
              <img
                src={previewUrl}
                alt="SVG 预览"
                draggable={false}
                className="h-full w-full object-contain"
                onLoad={handlePreviewLoad}
                onError={handlePreviewError}
              />
            </ZoomablePreview>
          )}
          {!previewUrl && (
            <div
              className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
              style={{ height: DEFAULT_PREVIEW_HEIGHT }}
            >
              <Loader2 className="size-4 animate-spin" />
              正在准备 SVG 预览
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** SVG 错误状态。 */
function SvgError({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center p-4"
      style={{ height: DEFAULT_PREVIEW_HEIGHT }}
    >
      <div className="flex max-w-xl items-start gap-2 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}
