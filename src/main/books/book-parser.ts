import fs from 'node:fs';
import JSZip from 'jszip';
import { initFoliatePolyfill } from './foliate-polyfill';
import { parseEpubFromBuffer, extractCoverFromZip } from '@shared/utils/book-parser';
import type { FoliateBook } from '@/components/reader/foliate-types';
import type { TOCItem } from '@shared/types/books';

/** 解析 EPUB 后提取的导入用元信息 */
export interface ParsedEpubInfo {
  title: string;
  author?: string;
  cover?: { bytes: Uint8Array; ext: string };
  totalChapters: number;
  rawBook: FoliateBook;
  tocs: TOCItem[];
}

/**
 * 主进程端解析 EPUB（仅用于导入流程和 AI 工具查 TOC）。
 * 复用 `@shared/book-parser` 的 foliate-js + JSZip 解析逻辑；本文件只负责 I/O 和封面提取。
 *
 * 使用前必须 initFoliatePolyfill() 让 foliate-js 跑在 jsdom polyfill 上。
 */
export async function parseEpubFile(filePath: string): Promise<ParsedEpubInfo> {
  initFoliatePolyfill();
  const buffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const parsed = await parseEpubFromBuffer(buffer, { copyBlob: true });

  return {
    title: parsed.metadata.title,
    author: parsed.metadata.author,
    cover: await extractCoverFromZip(zip, parsed.rawBook),
    totalChapters: parsed.metadata.totalChapters,
    rawBook: parsed.rawBook,
    tocs: parsed.tocs,
  };
}
