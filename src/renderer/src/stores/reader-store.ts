import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BookEntity } from '@shared/types/books';
import type { ChapterInfo, ReaderSelection, ReadingPosition } from '@shared/types/reader';
import { loadBookEntity } from '@/utils/book-loader';
import type { ReaderViewOperator } from '@/components/reader/foliate-types';
import { useTabsStore } from './tabs-store';

/**
 * 阅读器中一个 tab 的运行时状态。
 * 生命周期与 ReaderView 一致：mount 时 initReaderTab、unmount 时 deleteReaderTab。
 */
export interface ReaderTab {
  bookId: string;
  /** 加载完成前为 false，期间渲染 loading 态 */
  isReady: boolean;
  /** foliate-js 解析后的统一书实体，isReady=true 时保证有值 */
  book: BookEntity | null;
  /**
   * <foliate-view> 的能力投影。由 BookViewer 挂载时注入、卸载时清空。
   * navigateToPos / pageTurn 读这个 operator 调 foliate 方法，避开 store 持有 DOM。
   */
  readerViewOperator: ReaderViewOperator | null;
  /** 当前章节。由 foliate relocate 事件维护；unmount 后置 null */
  currentChapter: ChapterInfo | null;
  /** 当前阅读位置（CFI + 进度 + 物理页）。由 foliate relocate 事件维护 */
  currentPosition: ReadingPosition | null;
  /** 用户选区。仅在 selectionchange 触发且选区非空时有值 */
  selection: ReaderSelection | null;
}

interface ReaderState {
  /** key 用 tabId（不是 bookId），支持多个 tab 同时打开同一本书。一个tabId标识了一个阅读状态 */
  tabs: Record<string, ReaderTab>;
  /**
   * 当前正在阅读的书的 bookId。
   * - 派生自 tabsStore 的当前激活 tab：激活项为 reader 类型时取 params.bookId
   * - 其他情况（未激活 reader tab、激活 home/chat 等）为 null
   * 通过订阅 tabsStore 同步，调用方直接 selector 即可。
   */
  currentReadingBookId: string | null;
  /**
   * 初始化一个 ReaderTab：写入 bookId，启动异步加载 BookEntity。
   * 加载完成后填充 book + isReady=true。
   * 注意：bookId 由调用方保证（从 tab.params.bookId 传入）。
   */
  initReaderTab: (tabId: string, bookId: string) => void;
  /** 卸载 ReaderTab，清理相关数据 */
  deleteReaderTab: (tabId: string) => void;
  /**
   * 跳转入口（TOC 用）：调 operator.goTo 触发 foliate 跳转。
   * operator 未就绪时（BookViewer 还没挂上）NOOP。
   */
  navigateToPos: (tabId: string, pos: string) => Promise<void>;
  /**
   * 翻页入口（翻页按钮用）：调 operator.prev/next 触发 foliate 翻页。
   * operator 未就绪时 NOOP。
   */
  pageTurn: (tabId: string, dir: 'prev' | 'next') => Promise<void>;
  /**
   * 按总进度跳转（底部进度条拖拽用）：调 operator.goToFraction。
   * fraction 为 0~1。operator 未就绪时 NOOP。
   */
  seekToFraction: (tabId: string, fraction: number) => Promise<void>;
  /**
   * BookViewer 创建 foliate-view 后调用，把操作器注入 store。
   * 卸载时传 null 清空。
   */
  setReaderViewOperator: (tabId: string, operator: ReaderViewOperator | null) => void;
  /**
   * 更新当前章节。由 foliate-view 的 relocate 事件触发。
   * chapter 为 null 时清空（BookViewer 卸载场景）。
   */
  setCurrentChapter: (tabId: string, chapter: ChapterInfo | null) => void;
  /**
   * 更新当前阅读位置。由 foliate-view 的 relocate 事件触发。
   * pos 为 null 时清空（BookViewer 卸载场景）。
   */
  setCurrentPosition: (tabId: string, pos: ReadingPosition | null) => void;
  /**
   * 更新用户选区。由 BookViewer 的 selectionchange 监听触发。
   * selection 为 null 时清空（选区消失或选区为空时）。
   */
  setSelection: (tabId: string, selection: ReaderSelection | null) => void;
}

/**
 * 派生自 tabsStore 的当前激活 tab，计算当前正在阅读的 bookId。
 * - 当前激活 tab 是 reader 类型：返回 params.bookId
 * - 其他情况（未激活 reader tab、激活 home/chat 等）返回 null
 */
function computeCurrentReadingBookId(): string | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  const active = tabs.find(t => t.id === activeTabId);
  if (!active || active.type !== 'reader') return null;
  return active.params?.bookId ?? null;
}

export const useReaderStore = create<ReaderState>()(
  immer((set, get) => ({
    tabs: {},
    currentReadingBookId: computeCurrentReadingBookId(),

    // 初始化tab
    initReaderTab: (tabId, bookId) => {
      set(state => {
        // 已存在则不重复初始化（防止 StrictMode 双调 mount）
        if (state.tabs[tabId]) return;
        state.tabs[tabId] = {
          bookId,
          isReady: false,
          book: null,
          readerViewOperator: null,
          currentChapter: null,
          currentPosition: null,
          selection: null,
        };
      });
      console.dir(`initReaderTab: ${tabId}, ${bookId} tabs:`, get().tabs);

      // 异步加载：BookLoader 内部带缓存，同一本书多 tab 共享同一份 BookEntity
      loadBookEntity(bookId)
        .then(book => {
          // tab 可能在加载完成前被卸载，跳过写回
          if (!get().tabs[tabId]) return;
          set(state => {
            const t = state.tabs[tabId];
            if (!t) return;
            t.book = book;
            t.isReady = true;
          });
          if (book.metadata.title) {
            useTabsStore.getState().updateTabTitle(tabId, book.metadata.title);
          }
          const tabSnapshot = useReaderStore.getState().tabs[tabId];
          console.log(
            `[initReaderTab] 书籍加载完成 tabId: ${tabId}`,
            JSON.parse(JSON.stringify(tabSnapshot))
          );
        })
        .catch(err => {
          console.error('[initReaderTab] 加载失败:', err);
        });
    },

    deleteReaderTab: tabId => {
      set(state => {
        delete state.tabs[tabId];
      });
      console.dir(`deleteReaderTab: ${tabId} tabs:`, get().tabs);
    },

    navigateToPos: async (tabId, pos) => {
      const op = get().tabs[tabId]?.readerViewOperator;
      if (!op) return;
      try {
        // currentChapter / currentPosition 由 foliate-view 的 relocate 事件统一维护
        await op.goTo(pos);
      } catch (err) {
        console.error('[readerStore] 跳转失败:', err);
      }
    },

    pageTurn: async (tabId, dir) => {
      const op = get().tabs[tabId]?.readerViewOperator;
      if (!op) return;
      try {
        await op[dir]();
      } catch (err) {
        console.error('[readerStore] 翻页失败:', err);
      }
    },

    seekToFraction: async (tabId, fraction) => {
      const op = get().tabs[tabId]?.readerViewOperator;
      if (!op) return;
      try {
        await op.goToFraction(fraction);
      } catch (err) {
        console.error('[readerStore] 进度跳转失败:', err);
      }
    },

    setReaderViewOperator: (tabId, operator) => {
      set(state => {
        const t = state.tabs[tabId];
        if (t) t.readerViewOperator = operator;
      });
    },

    setCurrentChapter: (tabId, chapter) => {
      set(state => {
        const t = state.tabs[tabId];
        if (t) t.currentChapter = chapter;
      });
    },

    setCurrentPosition: (tabId, pos) => {
      set(state => {
        const t = state.tabs[tabId];
        if (t) t.currentPosition = pos;
      });
    },

    setSelection: (tabId, selection) => {
      set(state => {
        const t = state.tabs[tabId];
        if (t) t.selection = selection;
      });
    },
  }))
);

// === 跨 store 同步：currentReadingBookId ===
// tabsStore 的 addTab / closeTab / activateTab / updateTabTitle 等操作会改 tabs 或 activeTabId，
// 触发此 listener 重新计算并写回 currentReadingBookId。listener 内部幂等，newId 不变时跳过写入。
useTabsStore.subscribe(() => {
  const newId = computeCurrentReadingBookId();
  if (useReaderStore.getState().currentReadingBookId !== newId) {
    useReaderStore.setState({ currentReadingBookId: newId });
  }
});
