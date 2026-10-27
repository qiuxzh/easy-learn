import type { ReadingStatePayload } from '@shared/types/reader';
import { resolveTocIdByHref } from '@/utils/reader-utils';
import { useReaderStore } from '@/stores/reader-store';
import { useTabsStore } from '@/stores/tabs-store';

let intervalId: number | null = null;
let lastSentSignature: string | null = null;

/** 没有阅读状态时的哨兵签名：与任何真实签名都不相等，也区别于「还没推过」（null） */
const NO_STATE_SIGNATURE = '(none)';

function buildReadingStatePayload(): ReadingStatePayload | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  if (!activeTab || activeTab.type !== 'reader') return null;

  const readerTab = useReaderStore.getState().tabs[activeTab.id];
  if (!readerTab?.book || !readerTab.currentChapter || !readerTab.currentPosition) {
    return null;
  }

  const common = {
    bookId: readerTab.bookId,
    bookTitle: readerTab.book.metadata.title,
    progressPercent: Math.round(readerTab.currentPosition.percentage),
    updatedAt: new Date().toISOString(),
  };

  if (readerTab.book.type === 'pdf') {
    const { page } = readerTab.currentPosition;
    // 没有页码的 PDF 状态没有可用的位置信息，等 pageList 映射出来再推
    if (page === undefined) return null;
    return {
      ...common,
      bookType: 'pdf',
      page,
      pageCount: readerTab.book.rawBook.sections.length,
    };
  }

  return {
    ...common,
    bookType: 'epub',
    tocId: resolveTocIdByHref(readerTab.book.tocs, readerTab.currentChapter.href),
    chapterTitle: readerTab.currentChapter.title,
    chapterHref: readerTab.currentChapter.href,
    page: readerTab.currentPosition.page,
  };
}

function getReadingStateSignature(payload: ReadingStatePayload): string {
  if (payload.bookType === 'pdf') {
    return [
      payload.bookId,
      payload.bookTitle,
      payload.bookType,
      String(payload.progressPercent),
      String(payload.page),
      String(payload.pageCount),
    ].join('||');
  }

  return [
    payload.bookId,
    payload.bookTitle,
    payload.bookType,
    payload.tocId ?? '',
    payload.chapterTitle,
    payload.chapterHref,
    String(payload.progressPercent),
    String(payload.page ?? ''),
  ].join('||');
}

export function initReadingStateSync(): void {
  if (intervalId !== null) return;

  intervalId = window.setInterval(async () => {
    const payload = buildReadingStatePayload();
    const signature = payload ? getReadingStateSignature(payload) : NO_STATE_SIGNATURE;
    if (signature === lastSentSignature) {
      return;
    }

    try {
      await window.api.pushReadingState(payload);
      lastSentSignature = signature;
    } catch (error) {
      console.warn('[readingStateSync] 推送阅读状态失败:', error);
    }
  }, 1000);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    lastSentSignature = null;
  });
}
