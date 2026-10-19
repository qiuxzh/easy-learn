import { useEffect, useId, useState } from 'react';
import type { DiagramPlugin, MermaidConfig } from '@streamdown/mermaid';
import { Copy, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomRendererProps } from 'streamdown';
import { IconButton } from '@/components/ui/icon-button';
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

/** 一套 Mermaid 配色：节点槽位循环使用，另有连线、文字与分组底色。 */
type MermaidPalette = {
  node: { fill: string; border: string; text: string }[];
  line: string;
  text: string;
  clusterFill: string;
  clusterBorder: string;
};

/**
 * Mermaid 配色写字面色而不是 CSS 变量：mermaid 会对 themeVariables 做明暗运算，
 * 而它依赖的颜色库只认 hex / rgb() / hsl()，传 var() 或 color-mix() 派生的值会直接抛 Unsupported color format。
 * 代价是取值不跟随 CSS 变量，主题切换靠重新渲染承担（见 useThemeRevision）。
 */
const MERMAID_PALETTES: Record<'light' | 'dark', MermaidPalette> = {
  light: {
    node: [
      { fill: '#e0f2fe', border: '#38bdf8', text: '#0c4a6e' },
      { fill: '#fef3c7', border: '#f59e0b', text: '#78350f' },
      { fill: '#dcfce7', border: '#22c55e', text: '#14532d' },
      { fill: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' },
      { fill: '#ffe4e6', border: '#f43f5e', text: '#881337' },
      { fill: '#cffafe', border: '#06b6d4', text: '#164e63' },
    ],
    line: '#6b7280',
    text: '#111827',
    clusterFill: '#f8fafc',
    clusterBorder: '#cbd5e1',
  },
  dark: {
    node: [
      { fill: '#0b2a41', border: '#38bdf8', text: '#bae6fd' },
      { fill: '#3a2f1b', border: '#f59e0b', text: '#fde68a' },
      { fill: '#14351f', border: '#22c55e', text: '#bbf7d0' },
      { fill: '#2b2347', border: '#a78bfa', text: '#ddd6fe' },
      { fill: '#3f1d24', border: '#fb7185', text: '#fecdd3' },
      { fill: '#0e2e38', border: '#22d3ee', text: '#a5f3fc' },
    ],
    line: '#9ca3af',
    text: '#f4f4f5',
    clusterFill: '#232324',
    clusterBorder: '#43454a',
  },
};

/**
 * 生成按节点顺序循环分色的 CSS。
 */
function buildMermaidThemeCSS(palette: MermaidPalette): string {
  const slotCount = palette.node.length;

  return palette.node
    .map((colors, index) => {
      const nodeSelector = `.node:nth-child(${slotCount}n + ${index + 1})`;

      return `
${nodeSelector} rect,
${nodeSelector} circle,
${nodeSelector} ellipse,
${nodeSelector} polygon,
${nodeSelector} path {
  fill: ${colors.fill} !important;
  stroke: ${colors.border} !important;
}

${nodeSelector} .nodeLabel,
${nodeSelector} text,
${nodeSelector} .label {
  color: ${colors.text} !important;
  fill: ${colors.text} !important;
}`;
    })
    .join('\n');
}

/**
 * 组装 Mermaid 配置：整套配色取自 MERMAID_PALETTES，按根节点是否带 .dark 选亮/暗一套。
 */
function buildMermaidConfig(): MermaidConfig {
  const isDark = document.documentElement.classList.contains('dark');
  const palette = MERMAID_PALETTES[isDark ? 'dark' : 'light'];
  const primary = palette.node[0];

  return {
    theme: 'base',
    themeCSS: buildMermaidThemeCSS(palette),
    themeVariables: {
      darkMode: isDark,
      background: 'transparent',
      fontFamily: 'inherit',
      primaryColor: primary.fill,
      primaryBorderColor: primary.border,
      primaryTextColor: primary.text,
      mainBkg: primary.fill,
      nodeBorder: primary.border,
      secondaryColor: palette.node[1].fill,
      tertiaryColor: palette.node[2].fill,
      lineColor: palette.line,
      textColor: palette.text,
      titleColor: palette.text,
      clusterBkg: palette.clusterFill,
      clusterBorder: palette.clusterBorder,
    },
  };
}

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

    return mermaid.getMermaid(buildMermaidConfig()).render(renderId, source);
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
      className="my-4 overflow-hidden rounded-xl border border-stroke-3 bg-card"
      data-streamdown="mermaid-block"
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

          {viewMode === 'source' ? (
            <IconButton type="button" label="复制源码" onClick={() => void handleCopySource()}>
              <Copy />
            </IconButton>
          ) : (
            <IconButton
              type="button"
              label="复制图片"
              disabled={!currentResult?.svg}
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
