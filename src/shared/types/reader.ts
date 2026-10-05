/**
 * 阅读器运行时状态相关类型。
 * ReaderTab 的字段和 ReadingContext（reading-service 拼装产物）共用。
 */

import type { TOCItem } from './books';

/** 当前章节信息。由 foliate relocate 事件 / bookEntity.tocs 推算 */
export interface ChapterInfo {
  index: number;
  title: string;
  href: string;
}

/** 当前阅读位置。由 foliate relocate 事件推算 */
export interface ReadingPosition {
  cfi: string;
  /** 0~100 */
  percentage: number;
  /** 物理页码（来自 pageList，解析失败时不写） */
  page?: number;
}

/** renderer → main 的当前阅读状态同步载荷 */
export interface ReadingStatePayload {
  bookId: string;
  bookTitle: string;
  tocId: string | null;
  chapterTitle: string;
  chapterHref: string;
  progressPercent: number;
  /** ISO 8601 格式（new Date().toISOString()） */
  updatedAt: string;
}

/** 用户选中的文本及对应位置。仅在 selectionchange 触发且选区非空时存在 */
export interface ReaderSelection {
  text: string;
  cfi: string;
  chapterIndex: number;
  chapterTitle: string;
}

/**
 * 阅读上下文（派生数据）。
 * 每次按需拼装，不存。组装来源：
 * - 持久态：readerStore.tab.book（id / metadata / tocs）
 * - 运行时态：readerStore.tab 的 currentChapter / currentPosition / selection
 * - 瞬时态：timestamp（调用时刻）
 *
 */
export interface ReadingContext {
  bookId: string;
  bookTitle: string;
  curBookTocs: TOCItem[];
  author?: string;
  currentChapter: ChapterInfo;
  currentPosition: ReadingPosition;
  selection?: ReaderSelection;
  /** ISO 8601 格式（new Date().toISOString()） */
  timestamp: string;
}
