import { useEffect, useRef } from 'react';
import 'foliate-js/view.js'; // 副作用注册 <foliate-view> 自定义元素
import { useReaderStore } from '@/stores/reader-store';
import { useTabsStore } from '@/stores/tabs-store';
import { buildReaderCSS } from './reader-styles';
import { registerIframeKeyHandlers } from '@/utils/iframe-event-bridge';
import { parsePageLabel, resolveChapter } from '@/utils/reader-utils';
import type { FoliateViewElement, ReaderViewOperator } from './foliate-types';

interface BookViewerProps {
  readerTabId: string;
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

  // 容器：foliate-view append 到这里
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !rawBook) return;

    // 创建 foliate-view 并打开书籍
    const view = document.createElement('foliate-view') as FoliateViewElement;
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

    // 把当前主题样式注入 EPUB iframe
    const injectTheme = () => {
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

    // 翻页：左右箭头键映射到 foliate prev/next
    const turnPage = (key: string) => {
      if (key === 'ArrowLeft') view.prev();
      else if (key === 'ArrowRight') view.next();
    };

    // postMessage 桥接：iframe 内的键盘事件通过注册在 contentDocument 上的监听器转发
    const onBridgeMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'foliate-bridge:keydown') return;
      if (e.data.tabId !== readerTabId) return;
      if (useTabsStore.getState().activeTabId !== readerTabId) return;
      turnPage(e.data.key);
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
        turnPage(e.key);
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

    // 监听 foliate-js 的 load 事件（新章节渲染时触发），拿到 iframe contentDocument 注册键盘桥接
    // 绕过 closed shadow DOM 限制，外部 querySelector 无法穿透获取 iframe
    const onViewLoad = (e: Event) => {
      const doc = (e as CustomEvent<{ doc: Document }>).detail?.doc;
      if (!doc) return;
      registerIframeKeyHandlers(doc, readerTabId);
    };
    view.addEventListener('load', onViewLoad);

    // open + init 都是异步（open 内部 import paginator.js），串行等待后再 init 才能渲染内容
    (async () => {
      try {
        console.log('BookViewer: 开始加载渲染');
        await view.open(rawBook);
        // paginator 的首次 relocate 事件在 view.init 期间触发，监听器必须在 init
        // 之前挂上。view 自己的 #onRelocate 监听器（view.open 内部已加）会先于
        // 我们跑完并把 lastLocation 写好，这里读 lastLocation 一定有值。
        // 监听 renderer 而不是 view：view 重新 emit 时会把 reason 丢掉。
        view.renderer?.addEventListener('relocate', onRelocate);
        await view.init({ showTextStart: true });
        injectTheme();
      } catch (err) {
        console.error('[BookViewer] 加载渲染失败', err);
      }
    })();

    return () => {
      // 清理：清掉 store 里的运行时字段、销毁渲染器（含 ResizeObserver）、移除 DOM
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
    };
  }, [
    rawBook,
    bookTocs,
    readerTabId,
    setReaderViewOperator,
    setCurrentChapter,
    setCurrentPosition,
    setSelection,
  ]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-background"
      data-book-id={rawBook?.metadata?.title}
    />
  );
};

BookViewer.displayName = 'BookViewer';
