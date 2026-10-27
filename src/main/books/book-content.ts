// 分片与向量的替换只走 replaceBookChunks 和 clearBookContent；导入时的首次写入是例外。

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import type { BookType } from '@shared/types/books';
import type { BookPageBlock } from '@shared/types/ocr';
import { attachmentService } from '@main/service/attachment-service';
import { Constants } from '../constants';
import { runInTransaction } from '../db';
import {
  bookChunkRepo,
  bookEmbeddingRepo,
  bookPageRepo,
  bookRepo,
  bookStageRepo,
} from '../db/repo';
import type { BookRow } from '../db/schema';
import { parseEpubFile } from './book-parser';
import {
  DEFAULT_CHUNK_OPTIONS,
  chunkDocument,
  createEpubSource,
  createPdfSource,
  type ChunkDraft,
} from './etl/chunking';
import {
  classifyPdfText,
  readPdfText,
  type PdfTextKind,
  type PdfTextReport,
} from './etl/pdf/text-layer';
import { invalidateBookRetrieval } from './book-retrieval';

/** PDF 导入前的文本层探测结果。 */
export interface PdfProbe {
  /** 判定结论：有文本层 / 扫描版 */
  kind: PdfTextKind;
  /** 读到的逐页文本；读取失败或空文档时为 null */
  report: PdfTextReport | null;
  /** 缺文本层的页数 */
  missingPages: number;
  /** 读取或判定失败的原因；成功时为 null */
  error: string | null;
}

/** 一次导入的产物：书行本身，以及待登记的封面字节。 */
export interface ImportedBook {
  row: BookRow;
  cover: { bytes: Uint8Array; ext: string } | null;
}

/** 按扩展名分派导入流程。 */
export async function importBookFromFile(srcFilePath: string): Promise<ImportedBook> {
  return detectBookFormat(srcFilePath) === 'pdf'
    ? importPdfBook(srcFilePath)
    : importEpubBook(srcFilePath);
}

/**
 * 用一批新的切分产物整体替换一本书的分片。
 *
 * 删旧分片、写新分片、清向量、失效检索缓存在同一个事务里完成：分片一换，
 * 旧向量对应的正文已经不是同一段，留着会让检索返回对不上的内容。
 *
 * @returns 写入的分片数
 */
export function replaceBookChunks(bookId: string, drafts: ChunkDraft[]): number {
  const count = runInTransaction(() => {
    bookChunkRepo.deleteByBookId(bookId);
    const written = bookChunkRepo.createForBook(bookId, drafts);
    bookStageRepo.writeChunks(bookId, written);
    bookEmbeddingRepo.drop(bookId, null);
    return written;
  });
  invalidateBookRetrieval(bookId);
  return count;
}

/**
 * 重新切分一本 EPUB。
 *
 * @returns 新的分片数
 * @throws 书不存在，或不是 EPUB
 */
export async function rechunkBook(bookId: string): Promise<number> {
  const row = bookRepo.findById(bookId);
  if (!row) {
    throw new Error(`Book not found: ${bookId}`);
  }
  if (row.booksType !== 'epub') {
    throw new Error('该格式暂不支持重新分片');
  }

  const sourcePath = path.join(Constants.booksDir, row.booksStoreName);
  const info = await parseEpubFile(sourcePath);
  const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
  return replaceBookChunks(bookId, drafts);
}

/**
 * 清掉一本书的全部派生内容：页块、插图附件、分片、向量与阶段计数。
 *
 * 插图附件没有数据库级联，必须在删页块之前收集 id，否则文件永远留在磁盘上。
 */
export async function clearBookContent(bookId: string): Promise<void> {
  const attachmentIds = bookPageRepo
    .listBlocks(bookId)
    .flatMap(page => collectImageAttachmentIds(page.blocks));

  bookPageRepo.deleteByBook(bookId);
  bookStageRepo.resetOcr(bookId);
  await attachmentService.deleteAttachments(attachmentIds);

  runInTransaction(() => {
    bookChunkRepo.deleteByBookId(bookId);
    bookStageRepo.writeChunks(bookId, 0);
    bookEmbeddingRepo.drop(bookId, null);
  });
  invalidateBookRetrieval(bookId);
}

/**
 * 导入一本 EPUB。
 *
 * 切分失败不阻断导入：书行仍会写入，只是没有分片。
 *
 * @returns 书行与封面字节；没有内嵌封面时 cover 为 null
 */
async function importEpubBook(srcFilePath: string): Promise<ImportedBook> {
  const id = crypto.randomUUID();
  const info = await parseEpubFile(srcFilePath);

  // 切分失败不影响导入，drafts 留空表示这本书没有可检索分片
  let drafts: ChunkDraft[] = [];
  let chunked = false;
  try {
    drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
    chunked = true;
  } catch (e) {
    log.error(`[BookContent] chunkDocument failed, book imported without chunks: ${id}`, e);
  }

  fs.mkdirSync(Constants.booksDir, { recursive: true });

  const booksStoreName = `${id}.epub`;
  const row = bookRepo.create({
    id,
    booksName: info.title || path.basename(srcFilePath, path.extname(srcFilePath)),
    booksStoreName,
    booksType: 'epub',
    coverAttachment: null,
    totalChapters: info.totalChapters ?? null,
    description: null,
    author: info.author ?? null,
  });

  try {
    // books、book_chunks 与阶段行一起写；任一步失败都回滚 books 记录
    runInTransaction(() => {
      const count = bookChunkRepo.createForBook(id, drafts);
      // 切分成功才算这个阶段走完了；失败时留空行，表示还不知道要处理多少
      if (chunked) bookStageRepo.writeChunks(id, count);
      else bookStageRepo.createRows(id, ['chunk', 'embed']);
    });
    invalidateBookRetrieval(id);
  } catch (e) {
    bookChunkRepo.deleteByBookId(id);
    bookRepo.delete(id);
    throw e;
  }

  fs.copyFileSync(srcFilePath, path.join(Constants.booksDir, booksStoreName));
  return { row, cover: info.cover ?? null };
}

/**
 * 导入一本 PDF：读文本层、分片、建阶段行。
 *
 * 扫描版切出来是 0 片，这是事实而非未知；文本层读取失败与分片失败都不阻断导入。
 *
 * @returns 书行；PDF 没有内嵌封面，cover 恒为 null
 */
async function importPdfBook(srcFilePath: string): Promise<ImportedBook> {
  const id = crypto.randomUUID();
  fs.mkdirSync(Constants.booksDir, { recursive: true });

  const probe = await probePdfText(srcFilePath);

  const booksStoreName = `${id}.pdf`;
  const row = bookRepo.create({
    id,
    // 书名先用文件名，之后可由更新接口覆盖
    booksName: path.basename(srcFilePath, path.extname(srcFilePath)),
    booksStoreName,
    booksType: 'pdf',
    coverAttachment: null,
    // 页数在判定时即可确定
    totalPages: probe.report?.pageCount ?? null,
    totalChapters: null,
    description: null,
    author: null,
  });

  let drafts: ChunkDraft[] = [];
  let chunked = false;
  if (probe.report) {
    try {
      drafts = await chunkDocument(createPdfSource(probe.report), DEFAULT_CHUNK_OPTIONS);
      chunked = true;
    } catch (e) {
      log.error(`[BookContent] PDF chunkDocument failed, book imported without chunks: ${id}`, e);
    }
  }

  try {
    runInTransaction(() => {
      // PDF 的三个阶段永远适用：有文本层时识别阶段分母为 0，表示无需处理
      bookStageRepo.createRows(id, ['ocr', 'chunk', 'embed']);
      if (probe.kind === 'text') {
        bookStageRepo.setStageTotal(id, 'ocr', 0);
      } else if (probe.report) {
        // 分母是缺文本层的页数：只处理这些页，不是整本重来
        bookStageRepo.setStageTotal(id, 'ocr', probe.missingPages);
      } else if (probe.error) {
        // 读不出文本层时分母未知，只记原因
        bookStageRepo.setStageError(id, 'ocr', probe.error);
      }

      // 读到文本就写分片：0 片也要落库，它表示这本书现在没有可检索的正文
      if (chunked) {
        bookStageRepo.writeChunks(id, bookChunkRepo.createForBook(id, drafts));
      }
    });
    invalidateBookRetrieval(id);
  } catch (e) {
    bookChunkRepo.deleteByBookId(id);
    bookRepo.delete(id);
    throw e;
  }

  if (probe.kind === 'text' && probe.missingPages > 0) {
    // 这些页没有可检索的正文
    log.info(`[BookContent] PDF 有 ${probe.missingPages} 页没有文本层，未进入检索：${id}`);
  }

  fs.copyFileSync(srcFilePath, path.join(Constants.booksDir, booksStoreName));
  return { row, cover: null };
}

/**
 * 读 PDF 文本层并判定。
 *
 * 读取失败按扫描版返回，原因放进 `error`，不抛出。
 */
async function probePdfText(filePath: string): Promise<PdfProbe> {
  try {
    const report = await readPdfText(filePath);
    const classification = classifyPdfText(report);
    return {
      kind: classification.kind,
      report,
      missingPages: classification.missingPages,
      error: null,
    };
  } catch (e) {
    log.warn(`[BookContent] PDF 文本层读取失败，按扫描版处理：${filePath}`, e);
    return { kind: 'scanned', report: null, missingPages: 0, error: String(e) };
  }
}

/**
 * 按扩展名判断导入格式。
 *
 * 未知扩展名按 EPUB 处理；解析失败会在 `parseEpubFile` 中抛出。
 */
function detectBookFormat(filePath: string): BookType {
  return path.extname(filePath).toLowerCase() === '.pdf' ? 'pdf' : 'epub';
}

/** 收集一页里插图块的附件 id。 */
function collectImageAttachmentIds(blocks: BookPageBlock[]): string[] {
  return blocks
    .filter((block): block is Extract<BookPageBlock, { type: 'image' }> => block.type === 'image')
    .map(block => block.attachmentId);
}
