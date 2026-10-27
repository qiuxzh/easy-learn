import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import { dialog, ipcMain } from 'electron';
import type { FoliateBook } from '@/components/reader/foliate-types';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  BookDeleteRequest,
  BookDeleteResult,
  BookDoc,
  BookGetRequest,
  BookGetResult,
  BookImportResult,
  BookListResult,
  BookPickCoverResult,
  BookRechunkResult,
  BookType,
  BookUpdateRequest,
  BookUpdateResult,
  CoverImage,
  TOCItem,
} from '@shared/types/books';
import type { ImageContent } from '@shared/types/chat';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';
import {
  IMAGE_EXTENSIONS,
  imageMimeTypeFromExtension,
  resolveImageExtension,
} from '@shared/utils/file-util';
import {
  clampReadLength,
  clampReadOffset,
  clipDocumentRange,
  extractSegmentText,
  findNextTocItem,
  findTocById,
  resolveAnchorElement,
  resolveNextTocAnchorElement,
  toAttachmentUrl,
  toBook,
  toResultToc,
} from './util';
import { BaseService } from '@main/service';
import { attachmentService } from '@main/service/attachment-service';
import { Constants } from '../constants';
import { runInTransaction } from '../db';
import { bookChunkRepo, bookEmbeddingRepo, bookPageRepo, bookRepo, bookStageRepo } from '../db/repo';
import type { BookRow, InsertBookChunkRow, InsertBookRow } from '../db/schema';
import { getMainWindow } from '../window';
import { BookEmbeddingQueue } from './etl/embedding';
import { BookOcrRunner } from './etl/ocr/runner';
import type { OcrCommandResult, OcrEvent } from '@shared/types/ocr';
import type { EmbedStartRequest } from '@shared/types/embedding';
import { initFoliatePolyfill } from './foliate-polyfill';
import { parseEpubFile } from './book-parser';
import {
  DEFAULT_CHUNK_OPTIONS,
  buildPictureUnit,
  chunkDocument,
  createEpubSource,
  createPdfSource,
} from './etl/chunking';
import { toChunkRows } from './chunk-rows';
import { classifyPdfText, type PdfTextKind } from './etl/pdf/classify';
import type { PdfTextReport } from './etl/pdf/text-layer';
import { invalidateBookRetrieval } from './book-retrieval';

/** 章节正文分段读取的默认起始下标。 */
export const DEFAULT_READ_OFFSET = 0;
/** 章节正文分段读取的默认长度。 */
export const DEFAULT_READ_LENGTH = 12000;
/** 章节正文单次读取的硬上限，防止超长章节塞爆 LLM 上下文窗口。 */
export const MAX_READ_LENGTH = 30000;

/** 封面图片体积上限 */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/** PDF 导入前的文本层探测结果。 */
interface PdfProbe {
  /** 判定结论：有文本层 / 扫描版 / 无法判定 */
  kind: PdfTextKind;
  /** 读到的逐页文本；判定失败或空文档时为 null */
  report: PdfTextReport | null;
  /** 缺文本层的页数，也就是将来需要识别的页数 */
  missingPages: number;
  /** 判定失败的原因；成功时为 null */
  error: string | null;
}

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

/**
 * 书籍领域服务。
 *
 * 职责：
 * - 导入 / 列表 / 删除 / 更新书籍（IPC 给渲染层调用）
 * - 解析后的书籍内存缓存（getParsedBook），供 AI 工具链路复用
 * - 按 TOC 项读取章节正文（readBookTocText），供 AI reading-tools 工具使用
 *
 * 文件布局（相对 Constants.dataDir）：
 * - books/{booksStoreName}   拷贝后的源文件（epub / pdf）
 * - attachment/image/{id}    封面与按需读取的书籍插图附件，统一由 AttachmentService 落盘，book 表只存封面附件 id
 * - ocr-work/{bookId}/       OCR 分块上传时的临时切片，任务结束即删
 * - DB 中存 book + book_chunk + book_page 三张表，book_chunk 没有级联删除，必须显式清理
 *
 * 格式支持：EPUB 解析出分片供检索；PDF 导入时读文本层，有文本层直接分片，
 * 扫描版等 `book_page` 里的文字提取结果再分片；正文提取只对 EPUB 提供。
 */
export class BookService extends BaseService {
  /** 用户书籍根目录，书籍源文件都落在它下面 */
  bookDir: string;
  /** 解析后的 FoliateBook 缓存，key 是 bookId。
   *  简单 Map（无 LRU）：deleteBook / app 退出时清空；导入新书不清旧缓存。
   *  单本解析约 100-500ms，缓存命中后 readBookTocText 几乎零开销。 */
  private parsedBookCache = new Map<string, ParsedBookCacheEntry>();

  /** 向量化任务队列。运行态只活在它里面，不落库 */
  private readonly embeddingQueue: BookEmbeddingQueue;

  /** 文字提取（OCR）的编排。同一时刻只跑一本书 */
  private readonly ocrRunner: BookOcrRunner;

  constructor() {
    super();
    this.bookDir = path.resolve(Constants.dataDir, 'books');
    this.embeddingQueue = new BookEmbeddingQueue({
      onRuntime: runtime => {
        getMainWindow()?.webContents.send(IpcChannel.Book_EmbeddingRuntime, runtime);
      },
    });
    this.ocrRunner = new BookOcrRunner((event: OcrEvent) => {
      getMainWindow()?.webContents.send(IpcChannel.Book_OcrEvent, event);
    });
  }

  /**
   * 注册书籍相关 IPC 处理器：
   * - Book_PickAndImport     渲染层触发：弹文件选择框 → 解析 → 入库 → 返回 BookRow
   * - Book_GetAllBooks       渲染层拉取书库列表（每本书带自己的向量化信息）
   * - Book_DeleteBook        渲染层删除指定书籍
   * - Book_GetBook           渲染层打开书时调用：返回 app:// 协议 URL + 类型
   * - Book_PickCover         渲染层弹框选取封面图片（只读字节，不落盘）
   * - Book_UpdateBook        渲染层更新书名 / 作者 / 封面
   * - Book_RechunkBook       渲染层重新切分正文（重解析 + 替换分片 + 清向量）
   * - Book_Embedding*        渲染层驱动这本书的向量化任务（启动 / 暂停 / 继续 / 取消 / 取运行态）
   * - Book_Ocr*              渲染层驱动文字提取（开始 / 重新提取 / 取消 / 取运行态）
   */
  setupIpcHandlers(): void {
    // 书籍embedding操作
    ipcMain.handle(IpcChannel.Book_EmbeddingStart, (_event, req: EmbedStartRequest) =>
      this.embeddingQueue.start(req)
    );
    ipcMain.handle(IpcChannel.Book_EmbeddingPause, () => this.embeddingQueue.pause());
    ipcMain.handle(IpcChannel.Book_EmbeddingResume, () => this.embeddingQueue.resume());
    ipcMain.handle(IpcChannel.Book_EmbeddingCancel, () => this.embeddingQueue.cancel());
    ipcMain.handle(IpcChannel.Book_EmbeddingDescribe, () => this.embeddingQueue.describe());

    // 文字提取：开始 / 取消 / 取运行态。重新提取要先清掉旧结果
    ipcMain.handle(
      IpcChannel.Book_OcrStart,
      (_event, req: { bookId: string; restart?: boolean }) =>
        this.startOcr(req.bookId, req.restart === true)
    );
    ipcMain.handle(IpcChannel.Book_OcrCancel, () => this.ocrRunner.cancel());
    ipcMain.handle(IpcChannel.Book_OcrDescribe, () => this.ocrRunner.describe());

    ipcMain.handle(IpcChannel.Book_PickAndImport, async (): Promise<BookImportResult> => {
      try {
        const picked = await this.pickBookFile();
        if (!picked) return { success: false, canceled: true };

        const row = await this.importBook(picked.filePath);
        return { success: true, book: this.toBookDoc(row) };
      } catch (e) {
        log.error('[BookService] pickAndImport failed:', e);
        return { success: false, error: String(e) };
      }
    });

    ipcMain.handle(IpcChannel.Book_GetAllBooks, async (): Promise<BookListResult> => {
      try {
        const rows = bookRepo.findAll();
        // 一次查完全部阶段进度，避免按书逐个查询
        const stages = bookStageRepo.loadMany(rows.map(row => row.id));
        return {
          success: true,
          books: rows.map(row => toBook(row, this.readBookFileSize(row), stages[row.id] ?? {})),
        };
      } catch (e) {
        log.error('[BookService] getAllBooks failed:', e);
        return { success: false, error: String(e) };
      }
    });

    ipcMain.handle(
      IpcChannel.Book_DeleteBook,
      async (_e, req: BookDeleteRequest): Promise<BookDeleteResult> => {
        try {
          await this.deleteBook(req.id);
          return { success: true };
        } catch (e) {
          log.error('[BookService] deleteBook failed:', e);
          return { success: false, error: String(e) };
        }
      }
    );

    ipcMain.handle(
      IpcChannel.Book_GetBook,
      async (_e, req: BookGetRequest): Promise<BookGetResult> => {
        try {
          const row = bookRepo.findById(req.id);
          if (!row) {
            return { success: false, error: `Book not found: ${req.id}` };
          }
          // 构造 app:// 协议 URL（booksStoreName 已是 bookDir 下的文件名，相对 dataDir）
          const url = `app:///books/${row.booksStoreName}`;
          // name 给渲染端兜底：PDF 元信息里没有标题时用书籍名展示
          // coverUrl 给渲染端判断要不要补生成封面（PDF 的封面在首次打开时渲染）
          return {
            success: true,
            url,
            type: row.booksType,
            name: row.booksName,
            coverUrl: toAttachmentUrl(row.coverAttachment),
          };
        } catch (e) {
          log.error('[BookService] getBook failed:', e);
          return { success: false, error: String(e) };
        }
      }
    );

    ipcMain.handle(IpcChannel.Book_PickCover, async (): Promise<BookPickCoverResult> => {
      try {
        const cover = await this.pickCoverFile();
        if (!cover) return { success: false, canceled: true };
        return { success: true, cover };
      } catch (e) {
        log.error('[BookService] pickCover failed:', e);
        return { success: false, error: String(e) };
      }
    });

    ipcMain.handle(
      IpcChannel.Book_UpdateBook,
      async (_e, req: BookUpdateRequest): Promise<BookUpdateResult> => {
        try {
          const row = await this.updateBook(req);
          return { success: true, book: this.toBookDoc(row) };
        } catch (e) {
          log.error('[BookService] updateBook failed:', e);
          return { success: false, error: String(e) };
        }
      }
    );

    ipcMain.handle(
      IpcChannel.Book_RechunkBook,
      async (_e, req: BookGetRequest): Promise<BookRechunkResult> => {
        try {
          const chunks = await this.rechunkBook(req.id);
          return { success: true, total: chunks };
        } catch (e) {
          log.error('[BookService] rechunkBook failed:', e);
          return { success: false, error: String(e) };
        }
      }
    );
  }

  /**
   * 把一行书籍记录转成渲染端实体，顺带查它的阶段进度。
   * 批量路径不要用它——那里先用 `loadMany` 一次查完，避免按书逐个查询。
   */
  private toBookDoc(row: BookRow): BookDoc {
    return toBook(row, this.readBookFileSize(row), bookStageRepo.load(row.id));
  }

  /** 弹出文件选择框，返回用户选择的书籍路径（EPUB / PDF），取消选择则返回 null */
  private async pickBookFile(): Promise<{ filePath: string } | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '电子书', extensions: ['epub', 'pdf'] },
        { name: 'EPUB 文件', extensions: ['epub'] },
        { name: 'PDF 文件', extensions: ['pdf'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { filePath: result.filePaths[0] };
  }

  /** 按扩展名分派导入流程（当前支持 EPUB / PDF） */
  private async importBook(srcFilePath: string): Promise<BookRow> {
    return detectBookFormat(srcFilePath) === 'pdf'
      ? this.importPdfBook(srcFilePath)
      : this.importEpubBook(srcFilePath);
  }

  /**
   * 导入一本 EPUB（main 端完成解析 + 写库）：
   * 1. 解析 EPUB 并生成带 CFI 的正文分片
   * 2. 确保 bookDir 存在
   * 3. 写 DB 元信息和分片数据
   * 4. 把封面登记为附件并回写附件 id（如有）
   * 5. 拷贝源文件到 bookDir/{booksStoreName}
   */
  private async importEpubBook(srcFilePath: string): Promise<BookRow> {
    // 1. 解析 EPUB 并生成可检索的正文分片
    const id = crypto.randomUUID();
    const info = await parseEpubFile(srcFilePath);
    // Chunk 化失败不影响导入，chunks 留空表示该书没有可检索分片
    let chunks: InsertBookChunkRow[] = [];
    let chunked = false;
    try {
      const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
      chunks = toChunkRows(id, drafts);
      chunked = true;
    } catch (e) {
      log.error(`[BookService] chunkDocument failed, book imported without chunks: ${id}`, e);
    }

    // 2. 确保目录存在
    fs.mkdirSync(this.bookDir, { recursive: true });

    // 3. 写入元信息
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

    // 4. 写入正文分片与阶段状态
    try {
      // books、book_chunks 与阶段行都在本函数同步写入，DB 端靠 bookId 关联。
      // 任一步失败都要回滚 books 记录，避免出现"有书无文"的孤儿状态。
      runInTransaction(() => {
        bookChunkRepo.createMany(chunks);
        // 切分成功才算这个阶段走完了；失败时留空行，表示还不知道要处理多少
        if (chunked) bookStageRepo.writeChunks(id, chunks.length);
        else bookStageRepo.createRows(id, ['chunk', 'embed']);
      });
      // 同一 ID 的 Chunk 重新生成时，确保后续检索不会继续使用旧索引。
      invalidateBookRetrieval(id);
    } catch (e) {
      bookChunkRepo.deleteByBookId(id);
      bookRepo.delete(id);
      throw e;
    }

    // 5. 保存 cover（如有）
    if (info.cover) {
      const attachmentId = await this.storeCoverAttachment(info.cover.bytes, info.cover.ext);
      bookRepo.updateCoverAttachment(id, attachmentId);
      row.coverAttachment = attachmentId;
    }

    // 6. 拷贝源文件
    fs.copyFileSync(srcFilePath, path.join(this.bookDir, booksStoreName));

    return row;
  }
  /**
   * 导入一本 PDF：读文本层 → 分片 → 按判定补识别阶段。
   *
   * 1. 读文本层并判定：有文本层 / 扫描版 / 无法判定
   * 2. **一律走分片**：扫描版切出来是 0 片，这是一个事实，不是什么「未知」
   * 3. 判定为扫描版或无法判定时，额外建识别阶段行，等 OCR
   * 4. 拷贝源文件
   *
   * 分片失败与判定失败都不阻断导入：书仍然能读，只是暂时不能检索。
   * PDFium 走动态 import，避免主进程启动时就加载 WASM。
   */
  private async importPdfBook(srcFilePath: string): Promise<BookRow> {
    const id = crypto.randomUUID();
    fs.mkdirSync(this.bookDir, { recursive: true });

    const probe = await this.probePdfText(srcFilePath);

    const booksStoreName = `${id}.pdf`;
    const row = bookRepo.create({
      id,
      // 书名先用文件名：PDF 的元信息在渲染进程读，之后由 Book_UpdateBook 覆盖
      booksName: path.basename(srcFilePath, path.extname(srcFilePath)),
      booksStoreName,
      booksType: 'pdf',
      coverAttachment: null,
      // 页数在判定时就能拿到，不再等渲染层首次打开时回写
      totalPages: probe.report?.pageCount ?? null,
      totalChapters: null,
      description: null,
      author: null,
    });

    let chunks: InsertBookChunkRow[] = [];
    let chunked = false;
    if (probe.report) {
      try {
        const drafts = await chunkDocument(createPdfSource(probe.report), DEFAULT_CHUNK_OPTIONS);
        chunks = toChunkRows(id, drafts);
        chunked = true;
      } catch (e) {
        log.error(`[BookService] PDF chunkDocument failed, book imported without chunks: ${id}`, e);
      }
    }

    runInTransaction(() => {
      // PDF 的三个阶段永远都适用：有文本层时识别阶段的 total 为 0，表示无需处理，
      // 而不是「这个阶段不存在」。这样状态弹窗对任何 PDF 都能显示同一条链。
      bookStageRepo.createRows(id, ['ocr', 'chunk', 'embed']);
      if (probe.kind === 'scanned') {
        // 分母是「缺文本层的页数」：识别只处理这些页，不是整本重来
        bookStageRepo.setStageTotal(id, 'ocr', probe.missingPages);
      } else if (probe.kind === 'text') {
        bookStageRepo.setStageTotal(id, 'ocr', 0);
      } else if (probe.error) {
        bookStageRepo.setStageError(id, 'ocr', probe.error);
      }

      // 读到文本就写分片：0 片也要落库，它表示「这本书现在没有可检索的正文」
      if (chunked) {
        bookChunkRepo.createMany(chunks);
        bookStageRepo.writeChunks(id, chunks.length);
      }
    });

    if (probe.kind === 'text' && probe.missingPages > 0) {
      // 这些页切不出分片，也就进不了检索——状态弹窗目前没有地方承载它，先记日志
      log.info(`[BookService] PDF 有 ${probe.missingPages} 页没有文本层，未进入检索：${id}`);
    }

    fs.copyFileSync(srcFilePath, path.join(this.bookDir, booksStoreName));
    return row;
  }

  /** 读 PDF 文本层并判定。任何失败都降级成「无法判定」，不抛给导入流程。 */
  private async probePdfText(filePath: string): Promise<PdfProbe> {
    try {
      const { readPdfText } = await import('./etl/pdf/text-layer');
      const report = await readPdfText(filePath);
      const classification = classifyPdfText(report);
      return {
        kind: classification.kind,
        report,
        missingPages: classification.missingPages,
        error: null,
      };
    } catch (e) {
      log.warn(`[BookService] PDF 文本层判定失败，按无法判定处理：${filePath}`, e);
      return { kind: 'unknown', report: null, missingPages: 0, error: String(e) };
    }
  }

  /**
   * 删除一本书：
   * 1. 查询 DB 拿到书籍记录
   * 2. 删除封面附件（如有）
   * 3. 删除书籍源文件
   * 4. 删除正文分片和书籍记录
   * 文件删除失败仅记录日志，不影响 DB 删除（DB 是 UI 可见状态的唯一来源）
   */
  private async deleteBook(id: string): Promise<void> {
    const row = bookRepo.findById(id);
    if (!row) {
      throw new Error(`Book not found: ${id}`);
    }
    this.parsedBookCache.delete(id);

    // 封面与识别插图的附件都要删：附件表没有归属，书删了文件不会自己消失
    const pageAttachments = this.collectPageAttachments(id);
    const coverAttachments = row.coverAttachment ? [row.coverAttachment] : [];
    bookPageRepo.deleteByBook(id);
    await attachmentService.deleteAttachments([...coverAttachments, ...pageAttachments]);

    try {
      fs.unlinkSync(path.join(this.bookDir, row.booksStoreName));
    } catch (e) {
      log.warn(`[BookService] deleteBook: book file not found (${row.booksStoreName}):`, e);
    }

    // Chunk 与向量都没有数据库级联删除，必须在删除书籍记录前显式清理。
    // 向量散落在各模型的动态表里，不清就会永远留在库中，既占空间又让统计偏大。
    runInTransaction(() => {
      bookChunkRepo.deleteByBookId(id);
    });
    bookEmbeddingRepo.drop(id, null);
    invalidateBookRetrieval(id);
    bookRepo.delete(id);
  }

  /**
   * 重新切分一本书的正文，返回新的分片数。
   *
   * 重解析原文件 → 重切 → 替换分片 → 清掉该书在**所有**模型下的向量。
   * 四件事必须在同一个提交里：分片是按内容切出来的，替换之后旧向量对应的正文
   * 已经不是同一段了，留着只会让检索返回对不上的内容——而这种错误不会报错。
   */
  private async rechunkBook(id: string): Promise<number> {
    const row = bookRepo.findById(id);
    if (!row) {
      throw new Error(`Book not found: ${id}`);
    }
    if (row.booksType !== 'epub') {
      throw new Error('该格式暂不支持重新分片');
    }

    const sourcePath = path.join(this.bookDir, row.booksStoreName);
    const info = await parseEpubFile(sourcePath);
    const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
    const chunks = toChunkRows(id, drafts);

    runInTransaction(() => {
      bookChunkRepo.deleteByBookId(id);
      bookChunkRepo.createMany(chunks);
      // 分片换了，这本书的向量就不再对应同一段正文：阶段行归零与删向量都要在同一个提交里
      bookStageRepo.writeChunks(id, chunks.length);
      bookEmbeddingRepo.drop(id, null);
    });

    this.parsedBookCache.delete(id);
    invalidateBookRetrieval(id);
    return chunks.length;
  }

  /**
   * 开始文字提取。
   *
   * `restart` 为真时先清掉旧结果（页块、插图附件、分片、向量），
   * 这正是「重新提取」与「继续未完成的提取」的区别。
   */
  private async startOcr(bookId: string, restart: boolean): Promise<OcrCommandResult> {
    if (this.ocrRunner.describe()) {
      return { success: false, error: '另一本书正在提取，等它跑完再开始' };
    }

    if (restart) {
      await this.clearOcr(bookId);
    }
    return this.ocrRunner.start(bookId);
  }

  /**
   * 清掉一本书的识别结果及其下游产物。
   *
   * 顺序：先收集插图附件 id（块里的 JSON），再删页块与阶段计数，
   * 最后删附件文件。分片与向量都是由识别文字派生的，必须一起清，
   * 否则检索会命中一段已经不存在的正文。
   */
  private async clearOcr(bookId: string): Promise<void> {
    const attachmentIds = this.collectPageAttachments(bookId);

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

  /** 从页块 JSON 里收集全部插图附件 id。 */
  private collectPageAttachments(bookId: string): string[] {
    const ids: string[] = [];

    for (const row of bookPageRepo.listPages(bookId)) {
      let blocks: unknown;
      try {
        blocks = JSON.parse(row.blocks);
      } catch {
        continue;
      }
      if (!Array.isArray(blocks)) continue;

      for (const block of blocks) {
        if (isImageBlock(block)) ids.push(block.attachmentId);
      }
    }

    return ids;
  }

  /**
   * 更新书籍信息（书名 / 作者 / 封面），返回更新后的行。
   * 未出现在请求里的字段保持不变；书名去掉首尾空白后不允许为空，
   * 作者去掉首尾空白后为空则存 null，避免库里同时存在 '' 和 null 两种"无作者"。
   */
  private async updateBook(req: BookUpdateRequest): Promise<BookRow> {
    const row = bookRepo.findById(req.id);
    if (!row) {
      throw new Error(`Book not found: ${req.id}`);
    }

    const meta: Pick<InsertBookRow, 'booksName' | 'author'> = {
      booksName: row.booksName,
      author: row.author,
    };
    let metaChanged = false;

    if (req.booksName !== undefined) {
      const booksName = req.booksName.trim();
      if (!booksName) {
        throw new Error('书名不能为空');
      }
      meta.booksName = booksName;
      metaChanged = true;
    }

    if (req.author !== undefined) {
      const author = req.author?.trim();
      meta.author = author ? author : null;
      metaChanged = true;
    }

    if (metaChanged) {
      bookRepo.updateMeta(req.id, meta);
    }

    if (req.cover !== undefined) {
      await this.replaceCover(req.id, req.cover, row.coverAttachment);
    }

    const updated = bookRepo.findById(req.id);
    if (!updated) {
      throw new Error(`Book not found after update: ${req.id}`);
    }
    return updated;
  }

  /**
   * 替换或移除封面：cover 为 null 表示移除。
   * 新封面先登记为新附件再回写 book 行，url 随附件 id 变化、不会命中旧图缓存；
   * book 行更新成功后才删除旧附件。
   */
  private async replaceCover(
    bookId: string,
    cover: CoverImage | null,
    oldAttachmentId: string | null
  ): Promise<void> {
    if (!cover) {
      bookRepo.updateCoverAttachment(bookId, null);
      await attachmentService.deleteAttachments(oldAttachmentId ? [oldAttachmentId] : []);
      return;
    }

    const ext = resolveImageExtension(cover.ext);
    if (!ext) {
      throw new Error('封面仅支持 PNG / JPG / WebP / GIF / BMP 格式');
    }
    const bytes = Buffer.from(cover.bytes);
    if (bytes.length === 0) {
      throw new Error('封面图片内容为空');
    }
    if (bytes.length > MAX_COVER_BYTES) {
      throw new Error('封面图片过大，请选择 10MB 以内的图片');
    }

    const attachmentId = await this.storeCoverAttachment(bytes, ext);
    bookRepo.updateCoverAttachment(bookId, attachmentId);
    if (oldAttachmentId && oldAttachmentId !== attachmentId) {
      await attachmentService.deleteAttachments([oldAttachmentId]);
    }
  }

  /** 把封面字节登记为附件并返回附件 id；扩展名只用于推断 MIME，实际类型由附件服务按文件头兜底 */
  private async storeCoverAttachment(bytes: Uint8Array, ext: string): Promise<string> {
    const mimeType = imageMimeTypeFromExtension(ext) ?? '';
    const [stored] = await attachmentService.storeImages({
      images: [{ bytes, mimeType }],
    });
    if (!stored) {
      throw new Error('封面写入附件失败');
    }
    return stored.attachmentId;
  }

  /**
   * 弹出文件选择框读取封面图片的字节与扩展名（不落盘）。
   * 渲染层拿到字节后用 Blob URL 预览，用户点击保存时才真正写入磁盘。
   */
  private async pickCoverFile(): Promise<CoverImage | null> {
    const result = await dialog.showOpenDialog({
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const ext = resolveImageExtension(path.extname(filePath));
    if (!ext) {
      throw new Error('封面仅支持 PNG / JPG / WebP / GIF / BMP 格式');
    }

    const bytes = fs.readFileSync(filePath);
    if (bytes.length > MAX_COVER_BYTES) {
      throw new Error('封面图片过大，请选择 10MB 以内的图片');
    }
    return { bytes, ext };
  }

  /** 读取书籍源文件大小（字节）；文件缺失时返回 null，不影响列表展示 */
  private readBookFileSize(row: BookRow): number | null {
    try {
      return fs.statSync(path.join(this.bookDir, row.booksStoreName)).size;
    } catch (e) {
      log.warn(`[BookService] stat book file failed (${row.booksStoreName}):`, e);
      return null;
    }
  }

  /**
   * 获取指定书的目录树（嵌套 TOCItem）。
   * 主进程直接读 + 解析，跳过反向 IPC。
   * 失败（DB 找不到书 / 文件丢失 / 解析异常）一律返回空数组，不抛错影响 AI 工具链路。
   */
  async getBookTocs(bookId: string): Promise<TOCItem[]> {
    const parsed = await this.getParsedBook(bookId);
    return parsed?.tocs ?? [];
  }

  /**
   * AI 工具读取指定章节的纯文本（reading-tools 的核心入口）。
   *
   * 流程：
   * 1. getParsedBook 命中缓存直接复用，未命中则解析 epub 并写入缓存
   * 2. findTocById 在扁平化的 TOC 树里定位目标项
   * 3. resolveHref(toc.href) → 阅读顺序下标 + 锚点，sections[index] 拿到对应的文档单元
   * 4. findNextTocItem 取阅读顺序里的下一个同级或更高层目录项，作为结束边界
   * 5. 单元的 createDocument() 拿到 Document → clipDocumentRange 按两个锚点裁出本讲范围
   *    （下一项不在同一节、或本节没有锚点时，退化为读到节尾）→ extractSegmentText 取纯文本
   * 6. 按 offset（默认 0）和 length（默认 DEFAULT_READ_LENGTH，硬上限 MAX_READ_LENGTH）截取
   *
   * 失败（书不存在 / TOC 找不到 / segment 不存在 / createDocument 缺失 / 异常）
   * 一律返回结构化错误结果（success: false + error 字段），不抛错中断 AI 调用链。
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
  async readBookTocText(
    bookId: string,
    tocId: string,
    offset?: number,
    length?: number
  ): Promise<ReadBookTocTextResult> {
    const parsed = await this.getParsedBook(bookId);
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
      log.error(`[BookService] readBookTocText failed for ${bookId}/${tocId}:`, e);
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
  async readBookImage(bookId: string, resourceKey: string): Promise<ImageContent> {
    const row = bookRepo.findById(bookId);
    if (!row) {
      throw new Error(`书籍不存在：${bookId}`);
    }
    if (row.booksType !== 'epub') {
      throw new Error('该格式的图片读取尚未支持');
    }

    const parsed = await this.getParsedBook(bookId);
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
   * 命中缓存直接返回；未命中则读 DB 拿到路径 → 读文件 → parseEpubFromBuffer → 写入缓存。
   * 解析失败（文件丢失 / epub 损坏）返回 null，调用方负责降级（空 TOC / 空章节）；
   * 非 EPUB（例如 PDF）同样返回 null —— AI 工具链的正文读取目前只支持 EPUB。
   */
  private async getParsedBook(bookId: string): Promise<ParsedBookCacheEntry | null> {
    const cached = this.parsedBookCache.get(bookId);
    if (cached) {
      return cached;
    }

    const row = bookRepo.findById(bookId);
    if (!row) return null;

    if (row.booksType !== 'epub') {
      log.warn(`[BookService] getParsedBook: 暂不支持解析 ${row.booksType} 正文 (${bookId})`);
      return null;
    }

    const filePath = path.join(this.bookDir, row.booksStoreName);
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
      this.parsedBookCache.set(bookId, entry);
      return entry;
    } catch (e) {
      log.error(`[BookService] getParsedBook failed for ${bookId}:`, e);
      return null;
    }
  }
}

/**
 * 按扩展名判断导入格式。
 * 对话框已经限制了可选类型，这里作为最后一道判断；未知扩展名按 EPUB 处理，
 * 解析失败会在 parseEpubFile 里报错并中断导入。
 */
function detectBookFormat(filePath: string): BookType {
  return path.extname(filePath).toLowerCase() === '.pdf' ? 'pdf' : 'epub';
}

/**
 * 把格式无关的切分产物映射为 book_chunk 行，并补上书籍维度与主键。
 *
 * segment 与 locator 都是格式中立命名：EPUB 的 segment 是 spine section，
 * locator 是 CFI 或节级兜底定位串；后续 HTML / PDF 源复用同一张表。
 */
export const bookService = new BookService();

/** 块数组里的图片块。 */
function isImageBlock(value: unknown): value is { type: 'image'; attachmentId: string } {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as { type?: unknown; attachmentId?: unknown };
  return block.type === 'image' && typeof block.attachmentId === 'string';
}
