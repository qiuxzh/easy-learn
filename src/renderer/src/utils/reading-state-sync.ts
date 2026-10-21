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
  const normalizedProgressPercent = Math.round(readerTab.currentPosition.percentage);

  return {
    bookId: readerTab.bookId,
    bookTitle: readerTab.book.metadata.title,
    tocId: resolveTocIdByHref(readerTab.book.tocs, readerTab.currentChapter.href),
    chapterTitle: readerTab.currentChapter.title,
    chapterHref: readerTab.currentChapter.href,
    progressPercent: normalizedProgressPercent,
    updatedAt: new Date().toISOString(),
  };
}

function getReadingStateSignature(payload: ReadingStatePayload): string {
  return [
    payload.bookId,
    payload.bookTitle,
    payload.tocId ?? '',
    payload.chapterTitle,
    payload.chapterHref,
    String(payload.progressPercent),
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
