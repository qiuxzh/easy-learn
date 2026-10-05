import { useEffect, useId, useState } from 'react';
import type { DiagramPlugin, MermaidConfig } from '@streamdown/mermaid';
import { Copy, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomRendererProps } from 'streamdown';
import { Button } from '@/components/ui/button';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import {
  DEFAULT_PREVIEW_HEIGHT,
  ZoomablePreview,
} from '@/components/chat/markdown/ZoomablePreview';
import { copySvgImageToClipboard, getSvgDimensions } from '@/components/chat/markdown/svg-utils';

/** Mermaid 代码块的显示模式。 */
type MermaidViewMode = 'preview' | 'source';

/** Mermaid 异步渲染结果。 */
type MermaidRenderResult = {
  code: string;
  themeRevision: number;
  svg?: string;
  error?: string;
};

/** Mermaid 节点分色配置，业务主题可通过对应 CSS 变量覆盖。 */
type MermaidPaletteColor = {
  fill: string;
  border: string;
  text: string;
};

const MERMAID_NODE_PALETTE: MermaidPaletteColor[] = [
  {
    fill: 'var(--mermaid-node-1-fill, #e0f2fe)',
    border: 'var(--mermaid-node-1-border, #38bdf8)',
    text: 'var(--mermaid-node-1-text, #0c4a6e)',
  },
  {
    fill: 'var(--mermaid-node-2-fill, #fef3c7)',
    border: 'var(--mermaid-node-2-border, #f59e0b)',
    text: 'var(--mermaid-node-2-text, #78350f)',
  },
  {
    fill: 'var(--mermaid-node-3-fill, #dcfce7)',
    border: 'var(--mermaid-node-3-border, #22c55e)',
    text: 'var(--mermaid-node-3-text, #14532d)',
  },
  {
    fill: 'var(--mermaid-node-4-fill, #ede9fe)',
    border: 'var(--mermaid-node-4-border, #8b5cf6)',
    text: 'var(--mermaid-node-4-text, #4c1d95)',
  },
  {
    fill: 'var(--mermaid-node-5-fill, #ffe4e6)',
    border: 'var(--mermaid-node-5-border, #f43f5e)',
    text: 'var(--mermaid-node-5-text, #881337)',
  },
  {
    fill: 'var(--mermaid-node-6-fill, #cffafe)',
    border: 'var(--mermaid-node-6-border, #06b6d4)',
    text: 'var(--mermaid-node-6-text, #164e63)',
  },
];

/**
 * 为 Mermaid 节点生成循环分色 CSS。
 */
function buildMermaidThemeCSS(): string {
  const paletteSize = MERMAID_NODE_PALETTE.length;

  return MERMAID_NODE_PALETTE.map((palette, index) => {
    const nodeSelector = `.node:nth-child(${paletteSize}n + ${index + 1})`;

    return `
${nodeSelector} rect,
${nodeSelector} circle,
${nodeSelector} ellipse,
${nodeSelector} polygon,
${nodeSelector} path {
  fill: ${palette.fill} !important;
  stroke: ${palette.border} !important;
}

${nodeSelector} .nodeLabel,
${nodeSelector} text,
${nodeSelector} .label {
  color: ${palette.text} !important;
  fill: ${palette.text} !important;
}`;
  }).join('\n');
}

const MERMAID_BASE_CONFIG: MermaidConfig = {
  theme: 'base',
  themeCSS: buildMermaidThemeCSS(),
  themeVariables: {
    background: 'transparent',
    primaryColor: '#e0f2fe',
    primaryTextColor: '#111827',
    primaryBorderColor: '#38bdf8',
    lineColor: '#6b7280',
    secondaryColor: '#fef3c7',
    tertiaryColor: '#dcfce7',
    textColor: '#111827',
    mainBkg: '#e0f2fe',
    nodeBorder: '#38bdf8',
    clusterBkg: '#f8fafc',
    clusterBorder: '#cbd5e1',
    titleColor: '#111827',
    edgeLabelBackground: '#ffffff',
    fontFamily: 'inherit',
  },
};

const FALLBACK_CONTENT_WIDTH = 640;
const FALLBACK_CONTENT_HEIGHT = 320;

let mermaidPluginPromise: Promise<DiagramPlugin> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

/**
 * 按需加载 Mermaid 插件并复用同一个实例。
 */
function loadMermaidPlugin(): Promise<DiagramPlugin> {
  mermaidPluginPromise ??= import('@streamdown/mermaid').then(({ createMermaidPlugin }) =>
    createMermaidPlugin()
  );

  return mermaidPluginPromise;
}

/**
 * 串行执行 Mermaid 渲染，避免多个代码块同时修改全局配置。
 */
function renderMermaid(renderId: string, source: string): Promise<{ svg: string }> {
  const renderTask = mermaidRenderQueue.then(async () => {
    const mermaid = await loadMermaidPlugin();

    return mermaid.getMermaid(MERMAID_BASE_CONFIG).render(renderId, source);
  });

  mermaidRenderQueue = renderTask.then(
    () => undefined,
    () => undefined
  );

  return renderTask;
}

/**
 * 在根节点主题属性变化时增加版本号，驱动 Mermaid 重新渲染。
 */
function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setRevision(current => current + 1));

    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, []);

  return revision;
}

/**
 * 生成 Mermaid 渲染时使用的唯一标识。
 */
function createRenderId(baseId: string): string {
  return `${baseId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 支持源码、预览、缩放、拖动和复制的 Mermaid 代码块。
 */
export function MermaidBlock({ code, isIncomplete, language }: CustomRendererProps) {
  const [viewMode, setViewMode] = useState<MermaidViewMode>('preview');
  const [renderResult, setRenderResult] = useState<MermaidRenderResult | null>(null);
  const themeRevision = useThemeRevision();
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    if (isIncomplete || viewMode !== 'preview') {
      return;
    }

    let isCancelled = false;

    void renderMermaid(createRenderId(baseId), code)
      .then(result => {
        if (!isCancelled) {
          setRenderResult({ code, themeRevision, svg: result.svg });
        }
      })
      .catch((renderError: unknown) => {
        if (!isCancelled) {
          setRenderResult({
            code,
            themeRevision,
            error: renderError instanceof Error ? renderError.message : 'Mermaid 渲染失败',
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [baseId, code, themeRevision, isIncomplete, viewMode]);

  const currentResult =
    renderResult?.code === code && renderResult.themeRevision === themeRevision
      ? renderResult
      : null;
  const svgDimensions = currentResult?.svg ? getSvgDimensions(currentResult.svg) : undefined;

  /**
   * 复制当前 Mermaid 源码。
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
   * 复制当前 Mermaid 图片。
   */
  async function handleCopyImage() {
    if (!currentResult?.svg) {
      return;
    }

    try {
      await copySvgImageToClipboard(currentResult.svg);
      toast.success('已复制图片');
    } catch {
      toast.error('复制图片失败');
    }
  }

  return (
    <div
      className="my-4 overflow-hidden rounded-xl border border-border bg-sidebar"
      data-streamdown="mermaid-block"
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
              disabled={!currentResult?.svg}
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
          图表生成中，完成后将自动显示预览
        </div>
      ) : currentResult?.error ? (
        <div
          className="flex items-center justify-center p-4"
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <div className="flex max-w-xl items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Mermaid 渲染失败：{currentResult.error}</span>
          </div>
        </div>
      ) : currentResult?.svg ? (
        <ZoomablePreview
          contentWidth={svgDimensions?.width ?? FALLBACK_CONTENT_WIDTH}
          contentHeight={svgDimensions?.height ?? FALLBACK_CONTENT_HEIGHT}
          className="bg-background"
        >
          <div
            data-mermaid-svg
            data-sized={svgDimensions ? 'true' : undefined}
            className="h-full w-full"
            role="img"
            aria-label="Mermaid 图表"
            dangerouslySetInnerHTML={{ __html: currentResult.svg }}
          />
        </ZoomablePreview>
      ) : (
        <div
          className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
          style={{ height: DEFAULT_PREVIEW_HEIGHT }}
        >
          <Loader2 className="size-4 animate-spin" />
          正在渲染 Mermaid
        </div>
      )}
    </div>
  );
}
