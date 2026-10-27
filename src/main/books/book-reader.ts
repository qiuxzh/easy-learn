import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import type { FoliateBook } from '@/components/reader/foliate-types';
import type { TOCItem } from '@shared/types/books';
import type { ImageContent } from '@shared/types/chat';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';
import { imageMimeTypeFromExtension } from '@shared/utils/file-util';
import { attachmentService } from '@main/service/attachment-service';
import { Constants } from '../constants';
import { bookPageRepo, bookRepo } from '../db/repo';
import {
  clampReadLength,
  clampReadOffset,
  clipDocumentRange,
  extractSegmentText,
  findNextTocItem,
  findTocById,
  resolveAnchorElement,
  resolveNextTocAnchorElement,
  toResultToc,
} from './util';
import { initFoliatePolyfill } from './foliate-polyfill';
import { buildPictureUnit } from './etl/chunking';
import { ocrBlocksToText } from './etl/ocr/result';
import { readPdfPageTexts, renderPdfPagePng, type PdfTextPage } from './etl/pdf/pdf-pages';

export const DEFAULT_READ_OFFSET = 0;
export const DEFAULT_READ_LENGTH = 12000;
export const MAX_READ_LENGTH = 30000;

/**
 * 解析后 EPUB 的内存缓存项。
 * 解析 EPUB 涉及 foliate-js init + zip 加载，单本约 100-500ms，
 * AI 工具链路（readBookTocText 等）会按章节反复读同一本书，缓存避免重复 IO。
 */
interface ParsedBookCacheEntry {
  bookId: string;
  filePath: string;
  parsedAt: number;
  rawBook: FoliateBook;
  tocs: TOCItem[];
  /** 按 zip 内路径读资源字节，供按 key 读取书中图片使用 */
  loadResource: (href: string) => Promise<Uint8Array | null>;
}

/**
 * AI 工具读取指定章节的返回结果。
 * 失败也返回结构化对象（error 字段说明原因），不抛错中断 AI 调用链。
 */
export interface ReadBookTocTextResult {
  success: boolean;
  /** 命中的 TOC 项（用于回显给 AI / UI） */
  toc: Pick<TOCItem, 'id' | 'title' | 'level' | 'href'> | null;
  /** 命中文档单元的元信息，index 是阅读顺序下标 */
  segment: {
    index: number;
    id: string;
    linear?: string;
    size?: number | null;
  } | null;
  /** 本讲范围内的纯文本（已按锚点裁剪，并按 offset / length 截取） */
  text: string;
  /** 起始 href（即 TOC 项自己的 href，指向本讲开头） */
  startHref: string | null;
  /** 阅读顺序里下一个同级或更高层目录项的 href（AI 续读用），末项为 null */
  endHref: string | null;
  /** true 表示本次读取窗口之后仍有正文，可增大 offset 继续读取 */
  truncated: boolean;
  /** 当前返回窗口之后仍未返回的正文字符数；无截断时为 0 */
  truncatedChars: number;
  error?: string;
}

// 解析后的 FoliateBook 缓存，key 是 bookId。
// 简单 Map（无 LRU）：删除书籍 / 重新分片时清空；导入新书不清旧缓存。
// 单本解析约 100-500ms，缓存命中后 readBookTocText 几乎零开销。
const parsedBookCache = new Map<string, ParsedBookCacheEntry>();

/** 清掉某本书的解析缓存。书籍被删除或正文被替换后必须调用。 */
export function disposeBookCache(bookId: string): void {
  parsedBookCache.delete(bookId);
}

/**
 * 获取指定书的目录树（嵌套 TOCItem）。
 * 失败（DB 找不到书 / 文件丢失 / 解析异常）一律返回空数组，不抛错影响 AI 工具链路。
 */
export async function getBookTocs(bookId: string): Promise<TOCItem[]> {
  const parsed = await getParsedBook(bookId);
  return parsed?.tocs ?? [];
}

/**
 * AI 工具读取指定章节的纯文本。
 *
 * 先取解析结果与扁平 TOC 中的目标项，再按 href 解析出阅读顺序下标与锚点；下一个同级或
 * 更高层目录项作为结束边界，本节没有锚点时退化为读到节尾。最后按 offset 与 length
 * 截取窗口，length 默认 DEFAULT_READ_LENGTH，硬上限 MAX_READ_LENGTH。
 *
 * 失败（书不存在、TOC 或 segment 找不到、createDocument 缺失、解析异常）一律返回
 * 结构化错误结果（success: false 与 error 字段），不抛错中断 AI 调用链。
 *
 * @example 成功返回值（读取"反脆弱"第 5 章）：
 * ```ts
 * {
 *   success: true,
 *   toc: {
 *     id: '2-1',                                  // TOC 树里的稳定 id
 *     title: '第五章 试错',
 *     level: 2,
 *     href: 'OEBPS/Text/part0007.xhtml#ch05',     // 可能带 fragment
 *   },
 *   segment: {
 *     index: 6,                                   // 阅读顺序下标
 *     id: 'OEBPS/Text/part0007.xhtml',            // 同 toc.href 去掉 fragment
 *     linear: 'yes',
 *     size: 12345,
 *   },
 *   text: '在风和日丽的早晨，\n\n小王决定...',   // 已清洗：去 HTML 标签、压缩空白、块级元素换行
 *   startHref: 'OEBPS/Text/part0007.xhtml#ch05',
 *   endHref: 'OEBPS/Text/part0008.xhtml#ch06',   // 下一个同级目录项，末项为 null
 *   truncated: false,                             // 当前窗口之后仍有正文时为 true
 *   truncatedChars: 0,                            // 当前窗口之后未返回的正文字符数
 * }
 * ```
 *
 * @param offset 从章节纯文本第几个字符开始读取，默认 0
 * @param length 本次最多返回的字符数，默认 12000，最大 30000
 */
export async function readBookTocText(
  bookId: string,
  tocId: string,
  offset?: number,
  length?: number
): Promise<ReadBookTocTextResult> {
  const parsed = await getParsedBook(bookId);
  if (!parsed) {
    return {
      success: false,
      toc: null,
      segment: null,
      text: '',
      startHref: null,
      endHref: null,
      truncated: false,
      truncatedChars: 0,
      error: `Book not found: ${bookId}`,
    };
  }

  const toc = findTocById(parsed.tocs, tocId);
  if (!toc) {
    return {
      success: false,
      toc: null,
      segment: null,
      text: '',
      startHref: null,
      endHref: null,
      truncated: false,
      truncatedChars: 0,
      error: `TOC not found: ${tocId}`,
    };
  }
  if (!toc.href) {
    return {
      success: false,
      toc: toResultToc(toc),
      segment: null,
      text: '',
      startHref: null,
      endHref: null,
      truncated: false,
      truncatedChars: 0,
      error: `TOC href missing: ${tocId}`,
    };
  }

  try {
    // 把 toc.href（EPUB 内部相对路径）解析为阅读顺序下标 + 锚点
    const target = parsed.rawBook.resolveHref?.(toc.href);
    if (!target) {
      return {
        success: false,
        toc: toResultToc(toc),
        segment: null,
        text: '',
        startHref: toc.href,
        endHref: null,
        truncated: false,
        truncatedChars: 0,
        error: `TOC href cannot resolve to segment: ${toc.href}`,
      };
    }

    const segment = parsed.rawBook.sections[target.index];
    if (!segment) {
      return {
        success: false,
        toc: toResultToc(toc),
        segment: null,
        text: '',
        startHref: toc.href,
        endHref: null,
        truncated: false,
        truncatedChars: 0,
        error: `Segment not found: ${target.index}`,
      };
    }
    if (!segment.createDocument) {
      // 部分非标准 EPUB 章节没有 createDocument，无法取正文；
      // 仍返回 segment 元信息，方便 AI 知道"这章节存在但取不到文本"
      return {
        success: false,
        toc: toResultToc(toc),
        segment: {
          index: target.index,
          id: segment.id,
          linear: segment.linear,
          size: segment.size ?? null,
        },
        text: '',
        startHref: toc.href,
        endHref: null,
        truncated: false,
        truncatedChars: 0,
        error: `Segment document loader missing: ${target.index}`,
      };
    }

    const doc = await segment.createDocument();
    // 一个 xhtml 里常常塞着好几讲，必须按锚点把本节裁成当前目录项自己的范围
    const nextToc = findNextTocItem(parsed.tocs, tocId);
    const startEl = resolveAnchorElement(target.anchor, doc);
    const endEl = resolveNextTocAnchorElement(parsed.rawBook, nextToc, target.index, doc);
    clipDocumentRange(doc, startEl, endEl);

    // 图片按资源 key 插入占位，与分片内容保持同一套标识
    const fullText = extractSegmentText(doc, element => buildPictureUnit(element, segment.id));
    const start = clampReadOffset(offset, DEFAULT_READ_OFFSET);
    const readLength = clampReadLength(length, DEFAULT_READ_LENGTH, MAX_READ_LENGTH);
    const limitedText = fullText.slice(start, start + readLength);
    const truncatedChars = Math.max(0, fullText.length - (start + limitedText.length));

    return {
      success: true,
      toc: toResultToc(toc),
      segment: {
        index: target.index,
        id: segment.id,
        linear: segment.linear,
        size: segment.size ?? null,
      },
      text: limitedText,
      startHref: toc.href,
      // 阅读顺序里的下一节：AI 读完本讲后可继续读取，不用重新查 TOC
      endHref: nextToc?.href ?? null,
      truncated: truncatedChars > 0,
      truncatedChars,
    };
  } catch (e) {
    log.error(`[BookReader] readBookTocText failed for ${bookId}/${tocId}:`, e);
    return {
      success: false,
      toc: toResultToc(toc),
      segment: null,
      text: '',
      startHref: toc.href,
      endHref: null,
      truncated: false,
      truncatedChars: 0,
      error: String(e),
    };
  }
}

/**
 * 按书内资源 key 读取一张图片并登记为附件。
 * key 来自正文里的 `[[picture bookImage:{key}]]` 占位；登记出来的附件由调用方（工具结果）持有。
 * @throws 书籍不存在、格式暂不支持、key 对应的资源不存在时抛出可直接展示的原因
 */
export async function readBookImage(bookId: string, resourceKey: string): Promise<ImageContent> {
  const row = bookRepo.findById(bookId);
  if (!row) {
    throw new Error(`书籍不存在：${bookId}`);
  }
  if (row.booksType !== 'epub') {
    throw new Error('该格式的图片读取尚未支持');
  }

  const parsed = await getParsedBook(bookId);
  if (!parsed) {
    throw new Error('书籍解析失败，无法读取图片');
  }

  const bytes = await parsed.loadResource(resourceKey);
  if (!bytes) {
    throw new Error(`书籍内找不到该图片：${resourceKey}`);
  }

  const mimeType = imageMimeTypeFromExtension(path.extname(resourceKey)) ?? '';
  const [stored] = await attachmentService.storeImages({ images: [{ bytes, mimeType }] });
  if (!stored) {
    throw new Error('图片写入附件失败');
  }
  return stored;
}

/**
 * 拿 bookId 对应的解析后 EPUB。
 *
 * 命中缓存直接返回；未命中则读 DB 取路径、读文件、解析并写入缓存。
 * 文件丢失、EPUB 损坏与非 EPUB 都返回 null。
 */
async function getParsedBook(bookId: string): Promise<ParsedBookCacheEntry | null> {
  const cached = parsedBookCache.get(bookId);
  if (cached) {
    return cached;
  }

  const row = bookRepo.findById(bookId);
  if (!row) return null;

  if (row.booksType !== 'epub') {
    log.warn(`[BookReader] getParsedBook: 暂不支持解析 ${row.booksType} 正文 (${bookId})`);
    return null;
  }

  const filePath = path.join(Constants.booksDir, row.booksStoreName);
  try {
    // 主进程 jsdom 与 SharedArrayBuffer 不兼容，parseEpubFromBuffer 需要 copyBlob: true
    initFoliatePolyfill();
    const buffer = await fs.promises.readFile(filePath);
    const parsed = await parseEpubFromBuffer(buffer, { copyBlob: true });
    const entry: ParsedBookCacheEntry = {
      bookId,
      filePath,
      parsedAt: Date.now(),
      rawBook: parsed.rawBook,
      tocs: parsed.tocs,
      loadResource: parsed.loadResource,
    };
    parsedBookCache.set(bookId, entry);
    return entry;
  } catch (e) {
    log.error(`[BookReader] getParsedBook failed for ${bookId}:`, e);
    return null;
  }
}

/** 一次按页读取 PDF 文本的结果；`pages` 就是本次读到的页。 */
export interface ReadPdfPageTextResult {
  bookId: string;
  bookTitle: string;
  pageCount: number;
  startPage: number;
  /** 实际返回的最后一页；请求范围超过总页数时小于请求的 endPage */
  endPage: number;
  pages: PdfTextPage[];
}

/** 一次 PDF 页面图读取的结果；`image` 已登记为附件。 */
export interface ReadPdfPageImageResult {
  bookId: string;
  bookTitle: string;
  page: number;
  pageCount: number;
  image: ImageContent;
}

/**
 * 按 bookId 定位 PDF 源文件。
 *
 * @throws 书不存在、不是 PDF，或源文件缺失时抛出可直接展示的原因
 */
function resolvePdfBook(bookId: string): { bookTitle: string; filePath: string } {
  const row = bookRepo.findById(bookId);
  if (!row) {
    throw new Error(`书籍不存在：${bookId}`);
  }
  if (row.booksType !== 'pdf') {
    throw new Error('这本书不是 PDF，无法按页读取');
  }

  const filePath = path.join(Constants.booksDir, row.booksStoreName);
  if (!fs.existsSync(filePath)) {
    throw new Error('PDF 源文件不存在，可能已被移动或删除');
  }
  return { bookTitle: row.booksName, filePath };
}

/**
 * 用该书已完成的 OCR 结果填入文本层为空的页。
 *
 * 只处理 trim 后为空的页；没有对应 book_page 行的页保持空字符串。
 */
function fillEmptyPagesFromOcr(bookId: string, pages: PdfTextPage[]): void {
  const emptyPages = new Set(
    pages.filter(page => page.text.trim().length === 0).map(page => page.page)
  );
  if (emptyPages.size === 0) return;

  const ocrTexts = new Map(
    bookPageRepo
      .listPages(bookId, [...emptyPages])
      .map(page => [page.page, ocrBlocksToText(page.blocks)])
  );
  for (const page of pages) {
    if (emptyPages.has(page.page)) {
      page.text = ocrTexts.get(page.page) ?? '';
    }
  }
}

/**
 * 按页范围读取 PDF 文本层。
 *
 * 文本层为空的页回退到该书已完成的 OCR 结果（book_page）；两边都没有时返回空字符串。
 *
 * @param startPage 起始页，从 1 开始
 * @param endPage 结束页，从 1 开始，含；省略时只读 startPage
 * @returns 逐页文本与总页数
 * @throws 书不存在、不是 PDF、文件缺失、页码越界、PDF 无法读取，或 OCR 结果读取失败时抛出
 */
export async function readPdfPageText(
  bookId: string,
  startPage: number,
  endPage?: number
): Promise<ReadPdfPageTextResult> {
  if (endPage !== undefined && endPage < startPage) {
    throw new Error('页码范围无效：endPage 不能小于 startPage');
  }

  const { bookTitle, filePath } = resolvePdfBook(bookId);
  const texts = await readPdfPageTexts(filePath, startPage, endPage ?? startPage);
  fillEmptyPagesFromOcr(bookId, texts.pages);

  return {
    bookId,
    bookTitle,
    pageCount: texts.pageCount,
    startPage,
    endPage: texts.pages[texts.pages.length - 1].page,
    pages: texts.pages,
  };
}

/**
 * 把 PDF 的一页渲染成图片并登记为附件。
 *
 * @param page 页码，从 1 开始
 * @returns 附件引用与总页数；附件由工具结果持有
 * @throws 书不存在、不是 PDF、文件缺失、页码越界、PDF 无法读取，或附件写入失败时抛出
 */
export async function readPdfPageImage(
  bookId: string,
  page: number
): Promise<ReadPdfPageImageResult> {
  const { bookTitle, filePath } = resolvePdfBook(bookId);
  const rendered = await renderPdfPagePng(filePath, page);

  const [image] = await attachmentService.storeImages({
    images: [{ bytes: rendered.png, mimeType: 'image/png' }],
  });
  if (!image) {
    throw new Error('页面图写入附件失败');
  }

  return { bookId, bookTitle, page, pageCount: rendered.pageCount, image };
}
