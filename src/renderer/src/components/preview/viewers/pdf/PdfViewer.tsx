import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { buildPdfTextLayerCSS } from '@/utils/pdf-text-layer-css';
import type { ResourceDetailDTO } from '@shared/types/library';
import { loadPdfDocument, readBasePageSize, type PdfDocumentHandle } from './pdf-document';
import { PdfToolbar, type PdfViewMode } from './PdfToolbar';
import { PdfOutline } from './PdfOutline';
import { PdfPage } from './PdfPage';

/** 滚动模式里相邻两页的间距。 */
const PAGE_GAP = 16;
/**
 * 内容与滚动区上下边缘的留白。
 *
 * 没有它，第一页顶端会严丝合缝地贴在工具行下沿，滚动时纸张也被裁在那条线上，
 * 看起来就像工具行压住了正文。留一点底色，边界才读得出来。
 */
const PAGE_PAD = 16;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

/**
 * PDF viewer：状态、工具行、目录、两种布局容器都归自己管。
 *
 * 双模式共用一个 PdfPage 渲染单元，切换只换容器、保持页码、不重载文档。
 * 页尺寸以第一页为占位基准；每页渲染时仍用该页自己的 viewport。
 */
export const PdfViewer = memo(function PdfViewer({ detail }: { detail: ResourceDetailDTO }) {
  // 目录只认导入时写下的 docMeta：前端不解析、不回写，数据真身在主进程。
  const docMeta = detail.docMeta?.format === 'pdf' ? detail.docMeta : null;
  const toc = docMeta?.toc ?? null;
  const cachedPageCount = docMeta?.pageCount ?? 0;
  const url = detail.resource.url;

  const [handle, setHandle] = useState<PdfDocumentHandle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(cachedPageCount || 1);
  const [baseSize, setBaseSize] = useState({ width: 595, height: 842 });
  const [mode, setMode] = useState<PdfViewMode>('scroll');
  const [scale, setScale] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // 打开文档：只在资料变化时重载；切模式、切目录形态都不碰它。
  useEffect(() => {
    if (!url) {
      setLoadError('资料文件不存在');
      return;
    }
    let cancelled = false;
    let loaded: PdfDocumentHandle | null = null;
    setHandle(null);
    setLoadError(null);

    void (async () => {
      const doc = await loadPdfDocument(url);
      if (cancelled) {
        await doc.destroy();
        return;
      }
      loaded = doc;
      setHandle(doc);
      setPageCount(doc.pdf.numPages);
      setBaseSize(await readBasePageSize(doc.pdf));
    })().catch(error => {
      if (!cancelled) setLoadError(String(error));
    });

    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [url]);

  const pageHeight = baseSize.height * scale + PAGE_GAP;

  /**
   * 滚动位置 → 页码。
   *
   * 内容顶部有 PAGE_PAD 的留白，所以要减掉它；滚动到最顶端时结果为负数，夹回第 1 页。
   */
  const pageAtScroll = useCallback(
    (top: number): number => {
      const index = Math.floor((top - PAGE_PAD) / pageHeight) + 1;
      return Math.min(pageCount, Math.max(1, index));
    },
    [pageHeight, pageCount]
  );

  // 内容区高度用于算可视页范围；目录并排 / 浮动切换后会重新观测。
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const visiblePages = useMemo(() => {
    if (mode !== 'scroll' || !handle || viewportHeight <= 0) return [currentPage];
    const start = Math.max(1, pageAtScroll(scrollTop) - 1);
    const end = Math.min(pageCount, pageAtScroll(scrollTop + viewportHeight) + 1);
    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) pages.push(page);
    return pages;
  }, [mode, handle, viewportHeight, scrollTop, pageAtScroll, pageCount, currentPage]);

  const jumpTo = useCallback(
    (target: number): void => {
      const page = Math.min(pageCount, Math.max(1, Math.trunc(target)));
      setCurrentPage(page);
      // 内容顶部留了 PAGE_PAD，页顶 = PAD + (page-1)*pageHeight；
      // 想让页顶距视口上沿仍是 PAD，实际滚动量就还是 (page-1)*pageHeight。
      // 翻页模式下滚动容器没挂载，这一步自然跳过。
      if (scrollRef.current) scrollRef.current.scrollTop = (page - 1) * pageHeight;
    },
    [pageCount, pageHeight]
  );

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    setCurrentPage(pageAtScroll(element.scrollTop));
  };

  const changeScale = (value: number): void => {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100)));
  };

  const fitWidth = (): void => {
    const element = contentRef.current;
    if (!element || baseSize.width <= 0) return;
    // 减去左右留白和滚动条，否则「适应宽度」会刚好触发横向滚动。
    const available = element.clientWidth - PAGE_PAD * 2 - 10;
    if (available > 0) changeScale(available / baseSize.width);
  };

  /**
   * 一屏一页：整页高度刚好落在内容区里。
   *
   * 翻页模式底部浮着页码条（bottom-2，22px 高），不扣掉的话页面下沿会被它压住，
   * 那样「适应高度」就名不副实了。
   */
  const fitHeight = (): void => {
    const element = contentRef.current;
    if (!element || baseSize.height <= 0) return;
    const reserved = mode === 'page' ? 30 : 0;
    const available = element.clientHeight - PAGE_PAD * 2 - reserved;
    if (available > 0) changeScale(available / baseSize.height);
  };

  // 翻页模式的键盘翻页；输入框里打字时不要抢按键。
  useEffect(() => {
    if (mode !== 'page') return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        jumpTo(currentPage - 1);
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        jumpTo(currentPage + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, currentPage, jumpTo]);

  const rootStyle = {
    '--total-scale-factor': String(scale),
    '--scale-round-x': '1px',
    '--scale-round-y': '1px',
  } as CSSProperties;

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        无法打开 PDF：{loadError}
      </div>
    );
  }

  const outline = (
    <PdfOutline
      toc={toc}
      currentPage={currentPage}
      pageCount={pageCount}
      onJump={jumpTo}
      onClose={() => setTocOpen(false)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col" style={rootStyle}>
      <style>{buildPdfTextLayerCSS()}</style>

      <PdfToolbar
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(value => !value)}
        mode={mode}
        onModeChange={setMode}
        currentPage={currentPage}
        pageCount={pageCount}
        onJump={jumpTo}
        scale={scale}
        onScaleChange={changeScale}
        onFitWidth={fitWidth}
        onFitHeight={fitHeight}
      />

      <div className="flex min-h-0 flex-1">
        {tocOpen && <div className="w-[216px] shrink-0 border-r border-stroke-3">{outline}</div>}

        <div ref={contentRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {!handle ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在打开 PDF…
            </div>
          ) : mode === 'scroll' ? (
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-auto bg-secondary"
            >
              <div
                className="relative mx-auto"
                style={{
                  height: pageCount * pageHeight - PAGE_GAP + PAGE_PAD * 2,
                  minWidth: '100%',
                }}
              >
                {visiblePages.map(page => (
                  <div
                    key={page}
                    className="absolute left-0 right-0 flex justify-center"
                    style={{ top: PAGE_PAD + (page - 1) * pageHeight }}
                  >
                    <PdfPage pdf={handle.pdf} pageNumber={page} scale={scale} baseSize={baseSize} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 翻页模式：滚动容器与居中的内层分开。
               直接在滚动容器上用 items-center，页面比容器高时顶部会溢出到不可滚区，
               看着就像被上方工具行压住。min-h-full + 内层居中可以两头都滚得到。 */
            <div className="relative min-h-0 flex-1">
              <div className="h-full overflow-auto bg-secondary">
                <div className="flex min-h-full items-center justify-center p-4">
                  <PdfPage
                    pdf={handle.pdf}
                    pageNumber={currentPage}
                    scale={scale}
                    baseSize={baseSize}
                  />
                </div>
              </div>

              <button
                type="button"
                title="上一页"
                aria-label="上一页"
                disabled={currentPage <= 1}
                className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stroke-3 bg-background/90 shadow-sm hover:bg-secondary disabled:opacity-30"
                onClick={() => jumpTo(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="下一页"
                aria-label="下一页"
                disabled={currentPage >= pageCount}
                className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stroke-3 bg-background/90 shadow-sm hover:bg-secondary disabled:opacity-30"
                onClick={() => jumpTo(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-stroke-3 bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                <span className="tabular-nums">
                  {currentPage} / {pageCount}
                </span>
                <span className="h-1 w-24 overflow-hidden rounded-full bg-stroke-3">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${(currentPage / Math.max(pageCount, 1)) * 100}%` }}
                  />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
