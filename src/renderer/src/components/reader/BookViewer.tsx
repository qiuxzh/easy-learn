import { useEffect, useRef, useState } from 'react';
import 'foliate-js/view.js'; // 副作用注册 <foliate-view> 自定义元素
import { useConfigStore } from '@/stores/config-store';
import { useReaderStore } from '@/stores/reader-store';
import { useTabsStore } from '@/stores/tabs-store';
import { buildReaderCSS } from './reader-styles';
import { registerIframeKeyHandlers, registerReaderEdgeClick } from '@/utils/iframe-event-bridge';
import { parsePageLabel, resolveChapter } from '@/utils/reader-utils';
import { withFixedLayoutSpread } from '@/utils/pdf-book';
import type { ReaderConfig } from '@shared/config';
import type { FoliateViewElement, ReaderViewOperator } from './foliate-types';

interface BookViewerProps {
  readerTabId: string;
}

/**
 * 把阅读配置写到 foliate 的渲染器上。
 *
 * `flow` 决定翻页还是滚动；`max-column-count` 是「上限」不是「强制」，可用宽度不足时
 * foliate 会自行降栏，滚动模式下则整个忽略它。未配置按「翻页 + 单栏」处理，与
 * `DEFAULT_READER_CONFIG` 一致。
 * 固定版式（PDF、pre-paginated EPUB）由 <foliate-fxl> 渲染，没有这些属性，改为只应用缩放：
 * fxl 的 `zoom` 属性是响应式的（zoom / fit-width / fit-page），改动会立刻重排。
 * 属性值没变时自定义元素不触发回调，所以重复调用不会带来多余重排。
 */
function applyReaderConfig(
  view: FoliateViewElement | null,
  reader: ReaderConfig | undefined
): void {
  if (!view || !view.renderer) return;
  if (view.isFixedLayout) {
    view.renderer.setAttribute('zoom', String(reader?.pdfZoom ?? 'fit-page'));
    return;
  }
  view.renderer.setAttribute('flow', reader?.mode === 'scrolled' ? 'scrolled' : 'paginated');
  view.renderer.setAttribute('max-column-count', reader?.layout === 'double' ? '2' : '1');
}

/**
 * 书籍内容渲染容器。
 *
 * 工作流：
 * 1. 从 store 拿到 BookEntity（已由 loadBookEntity 集中加载）
 * 2. rawBook 变更时创建 <foliate-view>、appending 到容器，调用 open() 启动渲染
 * 3. 把翻页函数注入 store，供 TOCPanel 通过 navigateToPos 跳转
 * 4. rawBook 切换时清理旧 view，避免 shadow DOM 残留
 *
 */
export const BookViewer = ({ readerTabId }: BookViewerProps) => {
  const setReaderViewOperator = useReaderStore(s => s.setReaderViewOperator);
  const setCurrentChapter = useReaderStore(s => s.setCurrentChapter);
  const setCurrentPosition = useReaderStore(s => s.setCurrentPosition);
  const setSelection = useReaderStore(s => s.setSelection);
  const rawBook = useReaderStore(s => s.tabs[readerTabId]?.book?.rawBook);
  const bookTocs = useReaderStore(s => s.tabs[readerTabId]?.book?.tocs);
  const bookType = useReaderStore(s => s.tabs[readerTabId]?.book?.type);
  // 阅读配置。选到叶子上的原始值：选 config.reader 会在任何配置变更时重渲染
  const readerMode = useConfigStore(s => s.config.reader?.mode);
  const readerLayout = useConfigStore(s => s.config.reader?.layout);
  const readerPdfZoom = useConfigStore(s => s.config.reader?.pdfZoom);

  // 固定版式的跨页方式（单页 / 跨页）只能在 open() 之前写进 rendition ——
  // foliate 1.0.1 的 fxl 在 open() 里据此建 spreads，之后没有响应式入口。
  // 所以 PDF 的栏数变化靠重建 view 生效；EPUB 这个 key 恒为 null，不会触发多余重建。
  const fixedLayoutKey = bookType === 'pdf' ? readerLayout : null;

  // 容器：foliate-view append 到这里
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前 foliate-view。创建 effect 里写入，配置变更时靠它够得着渲染器
  const viewRef = useRef<FoliateViewElement | null>(null);
  // open + init 是否已完成。renderer 要等 open() 才存在，用它在就绪后补应用一次配置
  const [viewReady, setViewReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !rawBook) return;

    // 创建 foliate-view 并打开书籍
    const view = document.createElement('foliate-view') as FoliateViewElement;
    viewRef.current = view;
    view.classList.add('h-full', 'w-full');
    container.appendChild(view);
    // 立即把 view 的能力投影（operator）注入 store，navigateToPos / pageTurn 通过它调 foliate 方法
    const operator: ReaderViewOperator = {
      goTo: target => view.goTo(target),
      goToFraction: frac => view.goToFraction(frac),
      prev: distance => view.prev(distance),
      next: distance => view.next(distance),
      getLastLocation: () => view.lastLocation,
    };
    setReaderViewOperator(readerTabId, operator);

    // 把当前主题样式注入 EPUB iframe。
    // 固定版式必须跳过：fxl 渲染器没有 setStyles 方法（会抛 TypeError），
    // 而且注入的 `* { color: ... !important }` 会盖掉 PDF 文字层的透明色，页面出现重影文字。
    const injectTheme = () => {
      if (view.isFixedLayout) return;
      view.renderer?.setStyles(buildReaderCSS());
    };

    // 监听 html class 变化（暗黑模式切换），重新注入主题样式
    const observer = new MutationObserver(injectTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // foliate-js 翻页/锚点定位后触发。从 view.lastLocation 统一取数据写 store。
    const onRelocate = () => {
      const loc = view.lastLocation;
      if (!loc || !loc.section) return;
      const chapter = resolveChapter(loc.section.current, loc.tocItem, bookTocs, rawBook);
      setCurrentChapter(readerTabId, chapter);

      // SectionProgress 用各 section 的未压缩字节大小算 fraction（全局进度 0~1）。
      // 部分 EPUB 所有 section.size 为 0（BookLoader 的 getSize 未正确返回大小时），
      // sizeTotal = 0 → fraction = NaN，此时用章节索引 / 总章节数估算百分比。
      // 翻页时 fraction 依然 NaN（原始 sizes 不变），因此每次都走同一路径计算。
      const fraction = loc.fraction;
      const percentage =
        typeof fraction === 'number' && Number.isFinite(fraction)
          ? fraction * 100
          : loc.section.total > 0
            ? (loc.section.current / loc.section.total) * 100
            : 0;

      setCurrentPosition(readerTabId, {
        cfi: loc.cfi,
        percentage,
        page: parsePageLabel(loc.pageItem?.label),
      });
    };

    // 翻页：把方向映射到 foliate 的 prev / next
    const turn = (dir: 'prev' | 'next') => {
      if (dir === 'prev') view.prev();
      else view.next();
    };

    // 接收 iframe-event-bridge 转发过来的消息：iframe 内的按键和点击不会冒泡到父文档
    const onBridgeMessage = (e: MessageEvent) => {
      if (e.data?.tabId !== readerTabId) return;
      if (useTabsStore.getState().activeTabId !== readerTabId) return;

      if (e.data.type === 'foliate-bridge:keydown') {
        if (e.data.key === 'ArrowLeft') turn('prev');
        else if (e.data.key === 'ArrowRight') turn('next');
        return;
      }

      // 点击左右边缘翻页：方向已经判定好，这里只做方向到翻页的映射
      if (e.data.type === 'foliate-bridge:edge-click') {
        turn(e.data.direction === 'left' ? 'prev' : 'next');
      }
    };
    window.addEventListener('message', onBridgeMessage);

    // 直接在 document 上监听键盘事件（焦点在主文档时生效，iframe 内事件不冒泡）
    const onKeyDown = (e: KeyboardEvent) => {
      if (useTabsStore.getState().activeTabId !== readerTabId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        turn(e.key === 'ArrowLeft' ? 'prev' : 'next');
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // 监听 document 级别的 selectionchange（事件不冒泡，只能在 document 上监听）。
    // 只关心 foliate 章节 iframe 内的选区；主文档的 INPUT/TEXTAREA 选区会被过滤掉。
    const onSelectionChange = () => {
      if (useTabsStore.getState().activeTabId !== readerTabId) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(readerTabId, null);
        return;
      }
      const text = sel.toString();
      if (!text) {
        setSelection(readerTabId, null);
        return;
      }
      const anchor = sel.anchorNode;
      if (!anchor) return;
      // 选区必须在 foliate 章节 iframe 内（同源，contentDocument 可访问）
      const doc = anchor.ownerDocument;
      const frames = view.renderer?.querySelectorAll('iframe');
      const inFoliate = frames ? Array.from(frames).some(f => f.contentDocument === doc) : false;
      if (!inFoliate) {
        setSelection(readerTabId, null);
        return;
      }
      const loc = view.lastLocation;
      if (!loc || !loc.section) return;
      const range = sel.getRangeAt(0);
      const cfi = view.getCFI(loc.section.current, range);
      setSelection(readerTabId, {
        text,
        cfi,
        chapterIndex: loc.section.current,
        chapterTitle: loc.tocItem?.label ?? '',
      });
    };
    document.addEventListener('selectionchange', onSelectionChange);

    // foliate 每渲染一个章节就发一次 load，并把该章节的 document 带出来。
    // iframe 藏在 foliate 的 shadow DOM 里，外部查不到，只能借这个事件拿到 document 挂监听。
    const onViewLoad = (e: Event) => {
      const doc = (e as CustomEvent<{ doc: Document }>).detail?.doc;
      if (!doc) return;
      registerIframeKeyHandlers(doc, readerTabId);
      // 点击左右边缘翻页
      registerReaderEdgeClick(doc, container, readerTabId);
    };
    view.addEventListener('load', onViewLoad);

    // open + init 都是异步（open 内部 import paginator.js），串行等待后再 init 才能渲染内容
    (async () => {
      try {
        console.log('BookViewer: 开始加载渲染');
        // 固定版式的跨页方式必须在 open 之前定好，晚于 open 就不起作用了。
        // 不直接改 store 里的 book（hook 返回值不允许就地修改），复制一份带目标 spread 的对象。
        const openTarget =
          bookType === 'pdf'
            ? withFixedLayoutSpread(
                rawBook,
                useConfigStore.getState().config.reader?.layout === 'double' ? 'auto' : 'none'
              )
            : rawBook;
        await view.open(openTarget);
        // 赶在 init 首次排版之前设好，否则会先按 foliate 的默认排版跑一遍再重排。
        // 这里直接读快照而不是闭包里的配置：这个 effect 不依赖它们，
        // 闭包值可能已经过期；过期也无妨，下面的 effect 会再纠正一次。
        applyReaderConfig(view, useConfigStore.getState().config.reader);
        // paginator 的首次 relocate 事件在 view.init 期间触发，监听器必须在 init
        // 之前挂上。view 自己的 #onRelocate 监听器（view.open 内部已加）会先于
        // 我们跑完并把 lastLocation 写好，这里读 lastLocation 一定有值。
        // 监听 renderer 而不是 view：view 重新 emit 时会把 reason 丢掉。
        view.renderer?.addEventListener('relocate', onRelocate);
        await view.init({ showTextStart: true });
        injectTheme();
        // 渲染器到这一步才真正可用
        setViewReady(true);
      } catch (err) {
        console.error('[BookViewer] 加载渲染失败', err);
      }
    })();

    return () => {
      // 清理：清掉 store 里的运行时字段、销毁渲染器（含 ResizeObserver）、移除 DOM
      viewRef.current = null;
      setViewReady(false);
      setReaderViewOperator(readerTabId, null);
      setCurrentChapter(readerTabId, null);
      setCurrentPosition(readerTabId, null);
      setSelection(readerTabId, null);
      window.removeEventListener('message', onBridgeMessage);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      view.removeEventListener('load', onViewLoad);
      observer.disconnect();
      // listener 挂在 renderer 上；renderer 不存在时是 no-op
      view.renderer?.removeEventListener('relocate', onRelocate);
      try {
        view.close();
      } catch {
        /* 忽略 foliate-js 内部清理的异常 */
      }
      view.remove();
      // 不调用 rawBook.destroy()：BookEntity 由 book-loader 按 bookId 缓存、可能被多个 tab 共享，
      // 在这里销毁会把别的 tab 的 PDF 一起弄坏。它的生命周期跟缓存淘汰一起处理。
    };
  }, [
    rawBook,
    bookTocs,
    bookType,
    fixedLayoutKey,
    readerTabId,
    setReaderViewOperator,
    setCurrentChapter,
    setCurrentPosition,
    setSelection,
  ]);

  // 配置变更 → 应用到渲染器。切模式/切栏都不跳页：foliate 重排后会锚回原位置。
  // view 的重建由上面那个 effect 负责，这里不依赖 rawBook，所以改配置不会重新加载书。
  // 例外：PDF 的栏数（fixedLayoutKey）会重建 view，因为跨页方式只能在 open 前设定。
  useEffect(() => {
    applyReaderConfig(viewRef.current, {
      mode: readerMode,
      layout: readerLayout,
      pdfZoom: readerPdfZoom,
    });
  }, [readerMode, readerLayout, readerPdfZoom, viewReady]);

  return (
    <div
      ref={containerRef}
      // select-none：阅读区（含 foliate 给书页留的空白）不可选中。
      // 页面缩小后留白很宽，点空白翻页时按下的落点就在父文档里，浏览器会从应用自己的
      // 文字（如标签栏）拉出一段选区，铺过整个书页区域，看起来像"整页被选中"。
      // iframe 是独立文档，不受这条影响，页面内选字照旧。
      className="h-full w-full select-none bg-background"
      data-book-id={rawBook?.metadata?.title}
    />
  );
};

BookViewer.displayName = 'BookViewer';
