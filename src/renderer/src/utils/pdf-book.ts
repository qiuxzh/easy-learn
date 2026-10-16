import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type {
  FoliateBook,
  FoliateDestination,
  FoliateFixedLayoutSource,
  FoliateMetadata,
  FoliateSection,
  FoliateTocItem,
} from '@/components/reader/foliate-types';
import { buildPdfTextLayerCSS } from './pdf-text-layer-css';
import { INTERACTIVE_SELECTOR, shouldSuppressSelection } from './reader-interaction';

// ============================================================
// 为什么是 legacy 构建
// ============================================================
// pdfjs-dist 6.x 的默认构建用了 Promise.try（Chromium 128+）、Math.sumPrecise（133+）、
// Uint8Array.fromBase64（140+），后两者没有特性检测；本项目 Electron 30 是 Chromium 124，
// 直接 import 'pdfjs-dist' 会在渲染第一页时报 "Promise.try is not a function"。
// legacy 构建自带 core-js polyfill，功能一致，是本项目唯一可用的入口。

// ============================================================
// 常量
// ============================================================

/** 每页在 foliate 进度里的权重。等权即可，folio 只用它算百分比 */
const PAGE_SIZE_WEIGHT = 1000;

/** 没有 outline 时伪造目录的目标条目数，避免目录面板空着 */
const SYNTHETIC_TOC_ITEM_COUNT = 20;

/** 封面渲染比例：A4 约 595×841，1 倍即 595px 宽，书架卡片与详情页都够清晰 */
const COVER_RENDER_SCALE = 1;

/** 封面 JPEG 质量。该比例下单页约 70KB */
const COVER_JPEG_QUALITY = 80;

/** pdf.js 运行时资源（cmaps / standard_fonts / wasm / iccs）的 URL 前缀 */
const PDFJS_ASSET_BASE = new URL('pdfjs/', document.baseURI).href;

// ============================================================
// worker
// ============================================================

/**
 * pdf.js 的 worker 句柄。
 *
 * 为什么不设 GlobalWorkerOptions.workerSrc：在 file:// 加载的生产环境下，pdf.js 的
 * `_isSameOrigin` 会判定不同源，转手把 worker 包成一个 blob URL，而 blob worker 被
 * 现有 CSP（default-src 'self'）拦掉，最终退化为主线程的 fake worker，慢且阻塞 UI。
 * 自己建 module worker 再通过 workerPort 交给它，可以绕开这段包装逻辑（已实测）。
 *
 * 全局共享一个 worker：pdf.js 支持一个 worker 承载多个文档，各文档 destroy 只清理自己。
 */
let sharedWorker: Worker | null = null;

/** 懒创建共享 worker，并把它注册到 pdf.js */
function ensurePdfWorker(): void {
  if (sharedWorker) return;
  sharedWorker = new Worker(pdfWorkerUrl, { type: 'module' });
  pdfjs.GlobalWorkerOptions.workerPort = sharedWorker;
}

// ============================================================
// outline / 目标解析
// ============================================================

/** pdf.js outline 节点的最小结构 */
interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNode[];
}

/** pdf.js 的页面引用形如 { num, gen } */
function isPageRef(value: unknown): value is { num: number; gen: number } {
  if (!value || typeof value !== 'object') return false;
  const ref = value as { num?: unknown; gen?: unknown };
  return typeof ref.num === 'number' && typeof ref.gen === 'number';
}

/**
 * 把 outline 的 dest 解析成页下标。
 * dest 有两种形态：具名目标（字符串，需要 getDestination 查表）和显式目标数组（首元素是页面引用）。
 * 解析不了时返回 null，调用方按「该目录项不可跳转」处理。
 */
async function resolveDestinationPage(
  pdf: pdfjs.PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  if (dest === null) return null;
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (!isPageRef(ref)) return null;
    return await pdf.getPageIndex(ref);
  } catch (error) {
    console.warn('[pdf-book] 目录目标解析失败', error);
    return null;
  }
}

/**
 * outline → foliate 目录项，同时把每个目录项的 dest 解析成页号写进 destPages。
 *
 * 为什么在加载时一次性解析：foliate 的 resolveNavigation 是同步的，而 pdf.js 解析 dest
 * （getDestination + getPageIndex）是异步的；渲染层还有多处直接取 resolveHref().index。
 * 先落成「href → 页号」的表，跳转时就只是查表，签名也能保持同步。
 * 解析不出来的目录项 href 置空 —— foliate 与目录面板都按「不可跳转」处理。
 */
async function buildToc(
  pdf: pdfjs.PDFDocumentProxy,
  nodes: PdfOutlineNode[],
  destPages: Map<string, number>
): Promise<FoliateTocItem[]> {
  const items: FoliateTocItem[] = [];
  for (const node of nodes) {
    const subitems = node.items?.length ? await buildToc(pdf, node.items, destPages) : undefined;
    const page = await resolveDestinationPage(pdf, node.dest);
    const href = node.dest === null || page === null ? '' : JSON.stringify(node.dest);
    if (href && page !== null) destPages.set(href, page);
    items.push({
      label: node.title ?? '',
      href,
      ...(subitems ? { subitems } : {}),
    });
  }
  return items;
}

/** 没有 outline 时按页伪造一份目录，label 用页码 */
function buildSyntheticToc(pageCount: number, destPages: Map<string, number>): FoliateTocItem[] {
  const step = Math.max(1, Math.floor(pageCount / SYNTHETIC_TOC_ITEM_COUNT));
  const items: FoliateTocItem[] = [];
  for (let page = 0; page < pageCount; page += step) {
    const href = JSON.stringify(page);
    destPages.set(href, page);
    items.push({ label: `第 ${page + 1} 页`, href });
  }
  return items;
}

/** 页表：foliate 靠它把当前位置映射成页码（loc.pageItem.label） */
function buildPageList(pageCount: number, destPages: Map<string, number>): FoliateTocItem[] {
  return Array.from({ length: pageCount }, (_value, page) => {
    const href = JSON.stringify(page);
    destPages.set(href, page);
    return { label: String(page + 1), href };
  });
}

// ============================================================
// 页面渲染
// ============================================================

/** 同一页连续缩放会触发多次渲染，用序号把过期结果丢掉 */
const docRenderSeq = new WeakMap<Document, number>();

/** 单页 iframe 的 HTML 骨架：canvas 放位图，textLayer 放可选的文字层 */
function buildPageHtml(width: number, height: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<style>
html, body { margin: 0; padding: 0; background: #fff; }
${buildPdfTextLayerCSS()}
</style>
</head>
<body>
<div id="canvas"></div>
<div class="textLayer"></div>
</body>
</html>`;
}

/** 从 iframe 里往上找可滚动的祖先，找不到就用 window（跨 shadow 边界） */
function findScrollableAncestor(element: Element): HTMLElement | Window {
  let current: Element | null = element;
  while (current) {
    if (current.nodeType === 1) {
      const style = window.getComputedStyle(current);
      const overflow = `${style.overflow}${style.overflowX}${style.overflowY}`;
      if (/(auto|scroll)/.test(overflow)) {
        const scrollable = current as HTMLElement;
        if (
          scrollable.scrollHeight > scrollable.clientHeight ||
          scrollable.scrollWidth > scrollable.clientWidth
        ) {
          return scrollable;
        }
      }
    }
    const parent: Node | null = current.parentElement ?? current.parentNode;
    current = parent instanceof Element ? parent : ((parent as ShadowRoot | null)?.host ?? null);
  }
  return window;
}

/**
 * 手动放大后页面会超出视口，而滚轮事件不会从 iframe 冒泡到 foliate 的宿主容器，
 * 所以这里用「在页面上拖拽」来平移。起点落在文字上时不平移，保留原生文本选中。
 *
 * 每次渲染都会重新赋值 onpointer*，不会累积监听器（iframe 换页时 DOM 整体被替换）。
 */
function attachPanning(doc: Document, container: HTMLElement): void {
  let panning = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;
  let scroller: HTMLElement | Window | null = null;

  const stopPanning = (): void => {
    if (!panning) return;
    panning = false;
    scroller = null;
    container.style.cursor = 'grab';
  };

  container.style.cursor = 'grab';

  container.onpointerdown = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const onText = Boolean(target?.closest?.('span, br'));
    const hasSelection = (doc.getSelection()?.toString().length ?? 0) > 0;
    if (onText || hasSelection) return;

    const frame = doc.defaultView?.frameElement;
    if (!frame) return;

    panning = true;
    startX = event.screenX;
    startY = event.screenY;
    scroller = findScrollableAncestor(frame);
    if (scroller === window) {
      scrollLeft = window.scrollX;
      scrollTop = window.scrollY;
    } else {
      scrollLeft = (scroller as HTMLElement).scrollLeft;
      scrollTop = (scroller as HTMLElement).scrollTop;
    }
    container.style.cursor = 'grabbing';
  };

  container.onpointermove = (event: PointerEvent) => {
    if (!panning || !scroller) return;
    event.preventDefault();
    const deltaX = event.screenX - startX;
    const deltaY = event.screenY - startY;
    if (scroller === window) window.scrollTo(scrollLeft - deltaX, scrollTop - deltaY);
    else {
      (scroller as HTMLElement).scrollLeft = scrollLeft - deltaX;
      (scroller as HTMLElement).scrollTop = scrollTop - deltaY;
    }
  };

  container.onpointerup = stopPanning;
  container.onpointercancel = stopPanning;
  container.onpointerleave = stopPanning;
}

/** 已挂过页面交互的文档：同一个文档会因缩放反复渲染，交互只挂一次 */
const pageInteractionDocs = new WeakSet<Document>();

/**
 * 页面交互一次性挂载：拖拽平移 + 抑制「空白处按下 → 就近选区」。
 *
 * 文字层的 span 全是绝对定位，页面空白处（页边距、正文下方、图块）按下时，浏览器会把选区锚点
 * 落到页面开头那个文本节点上：手抖几像素，选区就从页首拉到指针处，看起来像整页被选中。
 * pdf.js 官方 viewer 靠 endOfContent 元素配合 selecting 类抑制它，而裸 TextLayer 既不创建
 * endOfContent 也不加 selecting（实测 DOM 里没有该元素），所以要在这里按判定结果拦掉按下。
 */
function attachPageInteractions(doc: Document, container: HTMLElement): void {
  if (pageInteractionDocs.has(doc)) return;
  pageInteractionDocs.add(doc);

  attachPanning(doc, container);

  doc.addEventListener('mousedown', (event: MouseEvent) => {
    const target = event.target as Element | null;
    const suppress = shouldSuppressSelection({
      primaryButton: event.button === 0,
      detail: event.detail,
      onText: Boolean(target?.closest?.('span, br')),
      onInteractive: Boolean(target?.closest?.(INTERACTIVE_SELECTOR)),
    });
    if (suppress) event.preventDefault();
  });
}

/**
 * 把一页画进 iframe：canvas 在父文档里渲染后再搬进 iframe，文字层重建。
 *
 * canvas 必须在 pdf.js 文档的 ownerDocument（也就是父文档）里创建 —— 字体挂在那边；
 * 画完再 adoptNode 进 iframe 展示。缩放时 foliate 会再调一次，整页按新比例重画。
 */
async function renderPdfPage(page: pdfjs.PDFPageProxy, doc: Document, zoom: number): Promise<void> {
  const sequence = (docRenderSeq.get(doc) ?? 0) + 1;
  docRenderSeq.set(doc, sequence);

  // 位图按「缩放 × 设备像素比」加密，但 canvas 的布局尺寸必须留在 zoom 空间：
  // 文字层的盒子（inset: 0）就是布局空间，若 canvas 只按位图尺寸布局、再靠根元素缩放压回来，
  // 文字层会比位图小一圈，超出的 span 会被 overflow: clip 裁掉，选区和亮条都短一截。
  const viewport = page.getViewport({ scale: zoom });
  const pixelRatio = devicePixelRatio;
  // 文字层的缩放变量与 canvas 同处 zoom 空间；pdf.js 自己只设 --min-font-size / --font-height / --scale-x
  const rootStyle = doc.documentElement.style;
  rootStyle.setProperty('--total-scale-factor', String(zoom));
  rootStyle.setProperty('--scale-round-x', '1px');
  rootStyle.setProperty('--scale-round-y', '1px');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width * pixelRatio);
  canvas.height = Math.round(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({
    canvas,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise;

  // 期间又触发了新的渲染，这次的结果已过期
  if (docRenderSeq.get(doc) !== sequence) return;

  const canvasContainer = doc.querySelector('#canvas');
  canvasContainer?.replaceChildren(doc.adoptNode(canvas));

  const textContainer = doc.querySelector<HTMLElement>('.textLayer');
  if (!textContainer) return;
  textContainer.replaceChildren();
  const textLayer = new pdfjs.TextLayer({
    textContentSource: await page.streamTextContent(),
    container: textContainer,
    viewport,
  });
  await textLayer.render();

  if (docRenderSeq.get(doc) !== sequence) return;

  // pdf.js 渲染文字层时会往父文档塞隐藏 canvas 量字宽，这里收起来避免影响布局
  for (const hidden of document.querySelectorAll('.hiddenCanvasElement')) {
    Object.assign((hidden as HTMLElement).style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      display: 'none',
    });
  }

  attachPageInteractions(doc, textContainer);
}

// ============================================================
// Book 适配器
// ============================================================

/**
 * PDF 适配后的 Book 对象。
 *
 * 用 class 而不是对象字面量：BookEntity 会被存进 zustand（immer 中间件），
 * immer 只深冻结「可草稿化」的普通对象；class 实例会被跳过，否则内部状态会被冻死。
 */
class PdfBook implements FoliateBook {
  readonly sections: FoliateSection[];
  readonly toc: FoliateTocItem[];
  readonly pageList: FoliateTocItem[];
  readonly metadata: FoliateMetadata;
  readonly rendition = { layout: 'pre-paginated' as const, spread: 'none' as const };
  readonly dir = 'ltr' as const;

  private readonly pdf: pdfjs.PDFDocumentProxy;
  /** 加载任务。销毁要调它（PDFDocumentProxy 上没有 destroy） */
  private readonly loadingTask: ReturnType<typeof pdfjs.getDocument>;
  /** 目录项 href → 页号。跳转/进度定位都靠它，保证 resolveHref 是同步的 */
  private readonly destPages: Map<string, number>;

  /** 每页的 iframe 骨架（blob URL）与缩放回调，按页缓存 */
  private readonly pageSources = new Map<number, FoliateFixedLayoutSource>();

  constructor(
    pdf: pdfjs.PDFDocumentProxy,
    loadingTask: ReturnType<typeof pdfjs.getDocument>,
    toc: FoliateTocItem[],
    pageList: FoliateTocItem[],
    destPages: Map<string, number>,
    metadata: FoliateMetadata
  ) {
    this.pdf = pdf;
    this.loadingTask = loadingTask;
    this.metadata = metadata;
    this.toc = toc;
    this.pageList = pageList;
    this.destPages = destPages;
    this.sections = Array.from({ length: pdf.numPages }, (_value, index) =>
      this.createSection(index)
    );
  }

  /** 生成第 index 页的 section（foliate 只要求 id / size / load） */
  private createSection(index: number): FoliateSection {
    return {
      // id 用字符串化的页号：foliate 只把它当 Map 键，但必须与 splitTOCHref 的返回值一致
      id: String(index),
      size: PAGE_SIZE_WEIGHT,
      load: async () => {
        const cached = this.pageSources.get(index);
        if (cached) return cached;

        const page = await this.pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const source: FoliateFixedLayoutSource = {
          src: URL.createObjectURL(
            new Blob([buildPageHtml(viewport.width, viewport.height)], { type: 'text/html' })
          ),
          onZoom: ({ doc, scale }) => renderPdfPage(page, doc, scale),
        };
        this.pageSources.set(index, source);
        return source;
      },
    };
  }

  /** 目录项 href → 页号。查不到（伪造目录之外的意外值）时回退到首页 */
  resolveHref(href: string): FoliateDestination {
    return { index: this.destPages.get(href) ?? 0 };
  }

  /** TOCProgress 用：href → [sectionId, fragment]。id 与 sections[].id 一致（字符串化页号） */
  splitTOCHref(href: string): [string | null, unknown] {
    const page = this.destPages.get(href);
    return [page === undefined ? null : String(page), null];
  }

  /** TOCProgress 用：PDF 的 fragment 恒为 null，返回文档根节点即可 */
  getTOCFragment(doc: Document): Node | null {
    return doc.documentElement;
  }

  /** 带协议前缀的链接（http:、mailto: 等）交给浏览器打开 */
  isExternal(uri: string): boolean {
    return /^\w+:/i.test(uri);
  }

  /**
   * 渲染首页为 JPEG 字节，供封面使用。
   *
   * 在渲染进程做（这里已经有 PDF 文档和 canvas），主进程就不必引入 PDFium / canvas 这类原生依赖。
   * 与页面渲染是两次独立的 render 调用，各自持有自己的 canvas，互不干扰。
   */
  async renderCoverJpeg(quality: number): Promise<Uint8Array> {
    const page = await this.pdf.getPage(1);
    const viewport = page.getViewport({ scale: COVER_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob) throw new Error('canvas 未能编码出 JPEG');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** 释放 pdf.js 文档；共享 worker 不在这里销毁 */
  async destroy(): Promise<void> {
    this.pageSources.clear();
    await this.loadingTask.destroy();
  }
}

/**
 * 把一份 PDF 的字节解析成 foliate 能直接 open 的 Book 对象。
 *
 * 注意：pdf.js 会把传入的 data 转移（transfer）给 worker，调用方传进来的
 * ArrayBuffer 在这之后会被分离（byteLength 变 0），不可复用。
 */
export async function makePdfBook(source: ArrayBuffer, fileName = ''): Promise<FoliateBook> {
  ensurePdfWorker();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(source),
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
    // 让主线程取资源：worker 的 base URL 是它自己的脚本地址，相对路径会解析错
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  const destPages = new Map<string, number>();
  const outline = (await pdf.getOutline()) as PdfOutlineNode[] | null;
  const toc = outline?.length
    ? await buildToc(pdf, outline, destPages)
    : buildSyntheticToc(pdf.numPages, destPages);
  const pageList = buildPageList(pdf.numPages, destPages);

  return new PdfBook(pdf, loadingTask, toc, pageList, destPages, await readMetadata(pdf, fileName));
}

/**
 * 生成 PDF 首页封面的 JPEG 字节。
 *
 * 传入的不是本适配层产出的 Book（例如 EPUB）时返回 null，由调用方跳过。
 */
export async function renderPdfCoverJpeg(book: FoliateBook): Promise<Uint8Array | null> {
  if (!(book instanceof PdfBook)) return null;
  return book.renderCoverJpeg(COVER_JPEG_QUALITY);
}

/**
 * 复制一份 Book 对象并替换固定版式的跨页方式。
 *
 * foliate 的 <foliate-fxl> 在 open() 时读 rendition.spread 建 spreads，之后改就不生效了；
 * 而 store 里的 Book 对象不允许就地修改（react-hooks 的 immutability 规则也会拦），
 * 所以复制一份带目标 spread 的对象交给 view.open()。
 * 必须用 Object.create 保留原型：resolveHref / splitTOCHref 等方法挂在原型上，展开运算符会丢掉。
 */
export function withFixedLayoutSpread(book: FoliateBook, spread: 'auto' | 'none'): FoliateBook {
  const clone = Object.create(Object.getPrototypeOf(book)) as FoliateBook;
  return Object.assign(clone, book, { rendition: { ...book.rendition, spread } });
}

/** 读取元信息；缺字段时依次回退到文件名 */
async function readMetadata(
  pdf: pdfjs.PDFDocumentProxy,
  fileName: string
): Promise<FoliateMetadata> {
  const fallbackTitle = fileName.replace(/\.pdf$/i, '');
  try {
    const { info, metadata } = await pdf.getMetadata();
    const infoRecord = (info ?? {}) as Record<string, unknown>;
    const infoTitle = typeof infoRecord.Title === 'string' ? infoRecord.Title : undefined;
    const infoAuthor = typeof infoRecord.Author === 'string' ? infoRecord.Author : undefined;
    const title = metadata?.get('dc:title') ?? infoTitle ?? fallbackTitle;
    const author = metadata?.get('dc:creator') ?? infoAuthor;
    const language = metadata?.get('dc:language');
    return { title, language, ...(author ? { creator: [{ name: author }] } : {}) };
  } catch (error) {
    console.warn('[pdf-book] 元信息读取失败，回退到文件名', error);
    return { title: fallbackTitle };
  }
}
