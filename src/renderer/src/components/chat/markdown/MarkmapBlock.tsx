import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, Maximize2, TriangleAlert, X } from 'lucide-react';
import type { Markmap as MarkmapView } from 'markmap-view';
import type { Transformer as MarkmapTransformer } from 'markmap-lib/no-plugins';
import { toast } from 'sonner';
import type { CustomRendererProps } from 'streamdown';
import { PreviewDialog } from '@/components/chat/PreviewDialog';
import { DEFAULT_PREVIEW_HEIGHT } from '@/components/chat/markdown/ZoomablePreviewArea';
import { copySvgImageToClipboard } from '@/components/chat/markdown/svg-utils';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { cn } from '@/lib/utils';

/** markmap 代码块的显示模式。 */
type MarkmapViewMode = 'preview' | 'source';

/** 按需加载的 markmap 模块集合。 */
type MarkmapModules = {
  Transformer: typeof MarkmapTransformer;
  Markmap: typeof MarkmapView;
};

let modulesPromise: Promise<MarkmapModules> | null = null;

/**
 * 按需加载 markmap；动态 import 让库单独成 chunk，首屏不加载。
 * transformer 用 no-plugins 入口：不捆绑 prism 高亮/行内 html/katex 扩展，
 * 大纲场景只需标题 + 缩进列表的层级解析。
 */
function loadMarkmapModules(): Promise<MarkmapModules> {
  modulesPromise ??= Promise.all([import('markmap-lib/no-plugins'), import('markmap-view')]).then(
    ([{ Transformer }, { Markmap }]) => ({ Transformer, Markmap })
  );

  return modulesPromise;
}

/**
 * 实例选项：容器自身就是视口，缩放/居中由库的 autoFit 负责。
 * 与 ReadAny 的用法一致——不在外层再做一次缩放，避免两个视口互相打架。
 * duration 0：不要入场/更新动画，数据一到就直接落定。
 * pan 关闭：库的 pan 也挂在 wheel 上，会和滚轮缩放叠在一起抢事件。
 */
const MARKMAP_OPTIONS = {
  autoFit: true,
  fitRatio: 0.8,
  duration: 0,
  maxWidth: 300,
  paddingX: 16,
  pan: false,
};

/**
 * 内联预览里只允许 Ctrl/⌘ + 滚轮缩放，普通滚轮交还给聊天区滚动。
 * 全屏预览不做限制：那是独立浮层，没有页面滚动可抢。
 */
function gateWheelZoom(instance: MarkmapView): void {
  instance.svg.call(
    instance.zoom.filter((event: WheelEvent | MouseEvent) => {
      if (event.type === 'wheel') {
        return (event.ctrlKey || event.metaKey) && !event.button;
      }

      return !event.button;
    })
  );
}

/**
 * 支持源码、预览、全屏查看与复制的 markmap 代码块。
 * AI 直接写 markdown 大纲（标题或嵌套列表），前端用 markmap 实例渲染。
 */
export function MarkmapBlock({ code, isIncomplete, language }: CustomRendererProps) {
  const [viewMode, setViewMode] = useState<MarkmapViewMode>('preview');
  const [isExpanded, setIsExpanded] = useState(false);
  /** 只记录已完成的渲染结果；当前 code 没有结果就是渲染中，避免在 effect 里同步 setState */
  const [rendered, setRendered] = useState<{ code: string; error?: string } | null>(null);

  const inlineSvgRef = useRef<SVGSVGElement>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement>(null);
  const inlineInstanceRef = useRef<MarkmapView | null>(null);
  const fullscreenInstanceRef = useRef<MarkmapView | null>(null);

  const current = rendered?.code === code ? rendered : null;
  const isRendered = Boolean(current && !current.error);
  const renderError = current?.error ?? null;

  // 内联实例：容器常驻（源码模式只隐藏），代码变化时复用实例重设数据
  useEffect(() => {
    if (isIncomplete) {
      return;
    }

    let isCancelled = false;

    void loadMarkmapModules()
      .then(({ Transformer, Markmap }) => {
        if (isCancelled || !inlineSvgRef.current) return null;

        const instance =
          inlineInstanceRef.current ?? new Markmap(inlineSvgRef.current, { ...MARKMAP_OPTIONS });
        if (!inlineInstanceRef.current) {
          gateWheelZoom(instance);
        }
        inlineInstanceRef.current = instance;

        const { root } = new Transformer().transform(code);

        return instance.setData(root).then(() => {
          if (isCancelled || !inlineSvgRef.current) return;
          // 文字色跟随主题 token：把库的取色变量指到 currentColor，由容器继承
          inlineSvgRef.current.style.setProperty('--markmap-text-color', 'currentColor');
          setRendered({ code });
        });
      })
      .catch((renderFailure: unknown) => {
        if (isCancelled) return;
        setRendered({
          code,
          error: renderFailure instanceof Error ? renderFailure.message : 'markmap 渲染失败',
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [code, isIncomplete]);

  // 组件卸载时销毁实例，释放库内部的缩放与折叠监听
  useEffect(
    () => () => {
      inlineInstanceRef.current?.destroy();
      inlineInstanceRef.current = null;
      fullscreenInstanceRef.current?.destroy();
      fullscreenInstanceRef.current = null;
    },
    []
  );

  // 全屏实例：每次打开新建、关闭销毁；等一帧让浮层容器有尺寸后再建
  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    let isCancelled = false;
    const frame = requestAnimationFrame(() => {
      void loadMarkmapModules().then(({ Transformer, Markmap }) => {
        if (isCancelled || !fullscreenSvgRef.current) return;

        const instance = new Markmap(fullscreenSvgRef.current, { ...MARKMAP_OPTIONS });
        fullscreenInstanceRef.current = instance;

        const { root } = new Transformer().transform(code);
        void instance.setData(root).then(() => {
          if (isCancelled || !fullscreenSvgRef.current) return;
          fullscreenSvgRef.current.style.setProperty('--markmap-text-color', 'currentColor');
        });
      });
    });

    return () => {
      isCancelled = true;
      cancelAnimationFrame(frame);
      fullscreenInstanceRef.current?.destroy();
      fullscreenInstanceRef.current = null;
    };
  }, [isExpanded, code]);

  /**
   * 复制当前渲染结果为 PNG：按屏幕上的实际视口序列化克隆节点。
   */
  async function handleCopyImage() {
    const svg = (isExpanded ? fullscreenSvgRef.current : inlineSvgRef.current) ?? null;
    if (!svg) return;

    try {
      const box = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(Math.round(box.width)));
      clone.setAttribute('height', String(Math.round(box.height)));

      await copySvgImageToClipboard(new XMLSerializer().serializeToString(clone));
      toast.success('已复制图片');
    } catch {
      toast.error('复制图片失败');
    }
  }

  /**
   * 复制当前 markmap 源码（markdown 大纲）。
   */
  async function handleCopySource() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('已复制源码');
    } catch {
      toast.error('复制源码失败');
    }
  }

  return (
    <div
      className="my-4 overflow-hidden rounded-xl border border-stroke-3 bg-card"
      data-streamdown="markmap-block"
    >
      {/* 表头内是 h-7 控件，min-h-9 与代码块表头同档 36px；纵向内边距超过 3px 就会把表头撑过 36px。用 min-h 而非 h：窄宽度换行时表头还要生长 */}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-stroke-3 bg-surface-2 px-2">
        <span className="ml-1 font-mono text-sm lowercase text-muted-foreground">{language}</span>
        <div className="flex flex-wrap items-center gap-1">
          <SegmentedToggle
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'source', label: '源码' },
              { value: 'preview', label: '预览' },
            ]}
          />

          {viewMode === 'preview' ? (
            <IconButton
              type="button"
              label="全屏查看"
              disabled={!isRendered || isIncomplete}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 />
            </IconButton>
          ) : null}

          {viewMode === 'source' ? (
            <IconButton type="button" label="复制源码" onClick={() => void handleCopySource()}>
              <Copy />
            </IconButton>
          ) : (
            <IconButton
              type="button"
              label="复制图片"
              disabled={!isRendered}
              onClick={() => void handleCopyImage()}
            >
              <Copy />
            </IconButton>
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
      ) : null}

      {isIncomplete ? (
        <div
          className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <Loader2 className="size-4 animate-spin" />
          大纲生成中，完成后将自动显示导图
        </div>
      ) : (
        // 预览容器常驻：切到源码只隐藏，切回来复用同一实例与同一视口
        <div
          className={cn('relative bg-background', viewMode === 'source' && 'hidden')}
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <svg ref={inlineSvgRef} className="h-full w-full" />

          {renderError ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="flex max-w-xl items-start gap-2 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>markmap 渲染失败：{renderError}</span>
              </div>
            </div>
          ) : null}

          {!isRendered && !renderError ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在渲染 markmap
            </div>
          ) : null}
        </div>
      )}

      <PreviewDialog open={isExpanded} onOpenChange={setIsExpanded} title="Markmap 思维导图">
        <div className="relative h-dvh w-screen bg-background">
          <svg ref={fullscreenSvgRef} className="h-full w-full" />

          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-card p-0.5 shadow-panel">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void fullscreenInstanceRef.current?.fit()}
            >
              适应
            </Button>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-stroke-4" />
            <IconButton size="xs" label="关闭预览" onClick={() => setIsExpanded(false)}>
              <X />
            </IconButton>
          </div>
        </div>
      </PreviewDialog>
    </div>
  );
}
