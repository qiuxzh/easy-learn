import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import type {
  BookDeleteResult,
  BookDto,
  BookGetResult,
  BookImportResult,
  BookListResult,
  BookRechunkResult,
  BookUpdateRequest,
  BookUpdateResult,
  CoverImage,
} from '@shared/types/books';
import { imageMimeTypeFromExtension, resolveImageExtension } from '@shared/utils/file-util';
import type { BookType } from '@shared/types/books';
import type { BookPageBlock } from '@shared/types/ocr';
import type { TransactionRunner } from '@main/contracts/transaction';
import type { Paths } from '@main/paths';
import type { AttachmentService } from '@main/service/attachment-service';
import type { BookRepos } from '@main/infra/repo/repos';
import type { BookEntity } from '@main/contracts/book';
import type { EmbedCommandResult, EmbedStartRequest } from '@shared/types/embedding';
import type { OcrCommandResult } from '@shared/types/ocr';
import type { BookReaderService } from './book-reader-service';
import type { BookRetrievalService } from './book-retrieval-service';
import type { BookEmbeddingRunner } from './etl/embedding';
import type { BookOcrRunner } from './ocr-runner';
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
} from './etl/pdf/pdf-pages';
import { replaceBookChunks } from './replace-chunks';
import { toAttachmentUrl, toBook } from './util';

/** 封面图片体积上限 */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

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
  row: BookEntity;
  cover: { bytes: Uint8Array; ext: string } | null;
}

/** 创建 BookService 所需的依赖。 */
export interface BookServiceDeps {
  /** 书籍域仓储。 */
  repos: BookRepos;
  /** 事务执行器，用于把跨仓储的写入合成一次提交。 */
  transaction: TransactionRunner;
  /** 附件服务，用于登记与回收封面。 */
  attachmentService: AttachmentService;
  /** 路径集合。 */
  paths: Paths;
  /** 域内子服务。 */
  bookServices: {
    /** 阅读侧读取。 */
    readerService: BookReaderService;
    /** 检索。 */
    retrievalService: BookRetrievalService;
    /** 向量化任务编排。 */
    embeddingService: BookEmbeddingRunner;
    /** 文字提取编排。 */
    ocrService: BookOcrRunner;
  };
}

/**
 * 书籍用例服务：列表与详情、导入、改名换封面、删除，以及两个后台流水线的入口。
 *
 * 源文件、封面与插图附件、OCR 临时切片分别落在 `paths.booksDir` 下的 books/、
 * attachment/image/ 与 ocr-work/。这里只做编排，不直接写分片、不解析 EPUB。
 */
export class BookService {
  private readonly transaction: TransactionRunner;
  private readonly repos: BookRepos;
  private readonly bookRepo: BookRepos['bookRepo'];
  private readonly bookChunkRepo: BookRepos['bookChunkRepo'];
  private readonly bookPageRepo: BookRepos['bookPageRepo'];
  private readonly bookStageRepo: BookRepos['bookStageRepo'];
  private readonly bookEmbeddingRepo: BookRepos['bookEmbeddingRepo'];
  private readonly attachmentService: AttachmentService;
  readonly readerService: BookReaderService;
  readonly retrievalService: BookRetrievalService;
  private readonly embeddingService: BookEmbeddingRunner;
  private readonly ocrService: BookOcrRunner;

  /** 用户书籍根目录，书籍源文件都落在它下面 */
  private readonly bookDir: string;

  constructor(deps: BookServiceDeps) {
    this.transaction = deps.transaction;
    this.repos = deps.repos;
    this.bookRepo = deps.repos.bookRepo;
    this.bookChunkRepo = deps.repos.bookChunkRepo;
    this.bookPageRepo = deps.repos.bookPageRepo;
    this.bookStageRepo = deps.repos.bookStageRepo;
    this.bookEmbeddingRepo = deps.repos.bookEmbeddingRepo;
    this.attachmentService = deps.attachmentService;
    this.readerService = deps.bookServices.readerService;
    this.retrievalService = deps.bookServices.retrievalService;
    this.embeddingService = deps.bookServices.embeddingService;
    this.ocrService = deps.bookServices.ocrService;
    this.bookDir = deps.paths.booksDir;
  }

  /* ───────────── 正文导入与派生内容 ───────────── */

  /** 按扩展名分派导入流程。 */
  async importFromFile(srcFilePath: string): Promise<ImportedBook> {
    return detectBookFormat(srcFilePath) === 'pdf'
      ? this.importPdfBook(srcFilePath)
      : this.importEpubBook(srcFilePath);
  }

  /**
   * 用一批新的切分产物整体替换一本书的分片。
   *
   * @returns 写入的分片数
   */
  replaceChunks(bookId: string, drafts: ChunkDraft[]): number {
    return replaceBookChunks(
      {
        transaction: this.transaction,
        repos: this.repos,
        retrievalService: this.retrievalService,
      },
      bookId,
      drafts
    );
  }

  /**
   * 重新切分一本 EPUB。
   *
   * @returns 新的分片数
   * @throws 书不存在，或不是 EPUB
   */
  async rechunk(bookId: string): Promise<number> {
    const row = this.bookRepo.findById(bookId);
    if (!row) {
      throw new Error(`BookEntity not found: ${bookId}`);
    }
    if (row.booksType !== 'epub') {
      throw new Error('该格式暂不支持重新分片');
    }

    const storeName = this.bookRepo.findStoreName(bookId);
    if (!storeName) {
      throw new Error(`BookEntity not found: ${bookId}`);
    }
    const sourcePath = path.join(this.bookDir, storeName);
    const info = await parseEpubFile(sourcePath);
    const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
    return this.replaceChunks(bookId, drafts);
  }

  /**
   * 清掉一本书的全部派生内容：页块、插图附件、分片、向量与阶段计数。
   *
   * 插图附件没有数据库级联，必须在删页块之前收集 id，否则文件永远留在磁盘上。
   */
  async clear(bookId: string): Promise<void> {
    const attachmentIds = this.bookPageRepo
      .listBlocks(bookId)
      .flatMap(page => collectImageAttachmentIds(page.blocks));

    this.bookPageRepo.deleteByBook(bookId);
    this.bookStageRepo.resetOcr(bookId);
    await this.attachmentService.deleteAttachments(attachmentIds);

    this.transaction(() => {
      this.bookChunkRepo.deleteByBookId(bookId);
      this.bookStageRepo.writeChunks(bookId, 0);
      this.bookEmbeddingRepo.drop(bookId, null);
    });
    this.retrievalService.invalidate(bookId);
  }

  /**
   * 导入一本 EPUB。
   *
   * 切分失败不阻断导入：书行仍会写入，只是没有分片。
   *
   * @returns 书行与封面字节；没有内嵌封面时 cover 为 null
   */
  private async importEpubBook(srcFilePath: string): Promise<ImportedBook> {
    const id = crypto.randomUUID();
    const info = await parseEpubFile(srcFilePath);

    // 切分失败不影响导入，drafts 留空表示这本书没有可检索分片
    let drafts: ChunkDraft[] = [];
    let chunked = false;
    try {
      drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
      chunked = true;
    } catch (e) {
      log.error(`[BookService] chunkDocument failed, book imported without chunks: ${id}`, e);
    }

    fs.mkdirSync(this.bookDir, { recursive: true });

    const booksStoreName = `${id}.epub`;
    const row = this.bookRepo.create({
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
      this.transaction(() => {
        const count = this.bookChunkRepo.createForBook(id, drafts);
        // 切分成功才算这个阶段走完了；失败时留空行，表示还不知道要处理多少
        if (chunked) this.bookStageRepo.writeChunks(id, count);
        else this.bookStageRepo.createRows(id, ['chunk', 'embed']);
      });
      this.retrievalService.invalidate(id);
    } catch (e) {
      this.bookChunkRepo.deleteByBookId(id);
      this.bookRepo.delete(id);
      throw e;
    }

    fs.copyFileSync(srcFilePath, path.join(this.bookDir, booksStoreName));
    return { row, cover: info.cover ?? null };
  }

  /**
   * 导入一本 PDF：读文本层、分片、建阶段行。
   *
   * 扫描版切出来是 0 片，这是事实而非未知；文本层读取失败与分片失败都不阻断导入。
   *
   * @returns 书行；PDF 没有内嵌封面，cover 恒为 null
   */
  private async importPdfBook(srcFilePath: string): Promise<ImportedBook> {
    const id = crypto.randomUUID();
    fs.mkdirSync(this.bookDir, { recursive: true });

    const probe = await probePdfText(srcFilePath);

    const booksStoreName = `${id}.pdf`;
    const row = this.bookRepo.create({
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
        log.error(`[BookService] PDF chunkDocument failed, book imported without chunks: ${id}`, e);
      }
    }

    try {
      this.transaction(() => {
        // PDF 的三个阶段永远适用：有文本层时识别阶段分母为 0，表示无需处理
        this.bookStageRepo.createRows(id, ['ocr', 'chunk', 'embed']);
        if (probe.kind === 'text') {
          this.bookStageRepo.setStageTotal(id, 'ocr', 0);
        } else if (probe.report) {
          // 分母是缺文本层的页数：只处理这些页，不是整本重来
          this.bookStageRepo.setStageTotal(id, 'ocr', probe.missingPages);
        } else if (probe.error) {
          // 读不出文本层时分母未知，只记原因
          this.bookStageRepo.setStageError(id, 'ocr', probe.error);
        }

        // 读到文本就写分片：0 片也要落库，它表示这本书现在没有可检索的正文
        if (chunked) {
          this.bookStageRepo.writeChunks(id, this.bookChunkRepo.createForBook(id, drafts));
        }
      });
      this.retrievalService.invalidate(id);
    } catch (e) {
      this.bookChunkRepo.deleteByBookId(id);
      this.bookRepo.delete(id);
      throw e;
    }

    if (probe.kind === 'text' && probe.missingPages > 0) {
      // 这些页没有可检索的正文
      log.info(`[BookService] PDF 有 ${probe.missingPages} 页没有文本层，未进入检索：${id}`);
    }

    fs.copyFileSync(srcFilePath, path.join(this.bookDir, booksStoreName));
    return { row, cover: null };
  }

  /* ───────────── 向量化 ───────────── */

  /* 向量化的启停由 BookEmbeddingRunner 直接暴露给 IPC，BookService 不再转发。 */

  /* ───────────── 文字提取 ───────────── */

  /**
   * 开始文字提取。
   *
   * `restart` 为真时先清掉旧结果（页块、插图附件、分片、向量），
   * 这正是「重新提取」与「继续未完成的提取」的区别。
   */
  async startOcr(bookId: string, restart: boolean): Promise<OcrCommandResult> {
    if (this.ocrService.describe()) {
      return { success: false, error: '另一本书正在提取，等它跑完再开始' };
    }

    if (restart) {
      this.readerService.dispose(bookId);
      await this.clear(bookId);
    }
    return this.ocrService.start(bookId);
  }

  /* ───────────── 书籍管理 ───────────── */

  /** 导入一个 EPUB/PDF 文件；文件框由调用方负责，这里只收路径。 */
  async importFile(filePath: string): Promise<BookImportResult> {
    try {
      const row = await this.importBook(filePath);
      return { success: true, book: this.toBookDoc(row) };
    } catch (e) {
      log.error('[BookService] importFile failed:', e);
      return { success: false, error: String(e) };
    }
  }

  /** 书库列表，附带每本书的阶段进度。 */
  listBooks(): BookListResult {
    try {
      const rows = this.bookRepo.findAll();
      // 一次查完全部阶段进度，避免按书逐个查询
      const stages = this.bookStageRepo.loadMany(rows.map(row => row.id));
      return {
        success: true,
        books: rows.map(row => toBook(row, this.readBookFileSize(row), stages[row.id] ?? {})),
      };
    } catch (e) {
      log.error('[BookService] getAllBooks failed:', e);
      return { success: false, error: String(e) };
    }
  }

  /**
   * 删除一本书：内容、封面附件、源文件、书籍记录。
   * 文件删除失败仅记录日志，不影响 DB 删除（DB 是 UI 可见状态的唯一来源）。
   */
  async removeBook(id: string): Promise<BookDeleteResult> {
    try {
      const row = this.bookRepo.findById(id);
      if (!row) {
        throw new Error(`BookEntity not found: ${id}`);
      }

      this.readerService.dispose(id);
      // 页块、分片、向量与插图附件都由 content 清；封面是书籍元信息，由这里删
      await this.clear(id);
      await this.attachmentService.deleteAttachments(
        row.coverAttachment ? [row.coverAttachment] : []
      );

      const storeName = this.bookRepo.findStoreName(id);
      try {
        if (!storeName) throw new Error('missing store name');
        fs.unlinkSync(path.join(this.bookDir, storeName));
      } catch (e) {
        log.warn(`[BookService] deleteBook: book file not found (${storeName ?? id}):`, e);
      }

      this.bookRepo.delete(id);
      return { success: true };
    } catch (e) {
      log.error('[BookService] deleteBook failed:', e);
      return { success: false, error: String(e) };
    }
  }

  /** 单本书的阅读入口：app:// URL、类型、名称与封面 URL。 */
  getBookDetail(id: string): BookGetResult {
    try {
      const row = this.bookRepo.findById(id);
      if (!row) {
        return { success: false, error: `BookEntity not found: ${id}` };
      }
      const storeName = this.bookRepo.findStoreName(row.id);
      if (!storeName) {
        return { success: false, error: `BookEntity not found: ${id}` };
      }
      // storeName 已是 bookDir 下的文件名，相对 dataDir
      const url = `app:///books/${storeName}`;
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

  /** 更新书名 / 作者 / 封面，返回更新后的完整书籍。 */
  async updateBookInfo(request: BookUpdateRequest): Promise<BookUpdateResult> {
    try {
      const row = await this.updateBook(request);
      return { success: true, book: this.toBookDoc(row) };
    } catch (e) {
      log.error('[BookService] updateBook failed:', e);
      return { success: false, error: String(e) };
    }
  }

  /** 重新分块；解析缓存先失效，否则阅读侧还会用旧的解析结果。 */
  async rechunkBook(bookId: string): Promise<BookRechunkResult> {
    try {
      this.readerService.dispose(bookId);
      const chunks = await this.rechunk(bookId);
      return { success: true, total: chunks };
    } catch (e) {
      log.error('[BookService] rechunkBook failed:', e);
      return { success: false, error: String(e) };
    }
  }

  /**
   * 把一行书籍记录转成渲染端实体，顺带查它的阶段进度。
   * 批量路径不要用它——那里先用 `loadMany` 一次查完，避免按书逐个查询。
   */
  private toBookDoc(row: BookEntity): BookDto {
    return toBook(row, this.readBookFileSize(row), this.bookStageRepo.load(row.id));
  }

  /** 导入入口：正文与书行由 content 生成，封面由这里登记（附件归书籍元信息管）。 */
  private async importBook(srcFilePath: string): Promise<BookEntity> {
    const { row, cover } = await this.importFromFile(srcFilePath);
    if (!cover) return row;

    const attachmentId = await this.storeCoverAttachment(cover.bytes, cover.ext);
    this.bookRepo.updateCoverAttachment(row.id, attachmentId);
    row.coverAttachment = attachmentId;
    return row;
  }

  /**
   * 更新书籍信息（书名 / 作者 / 封面），返回更新后的行。
   * 未出现在请求里的字段保持不变；书名去掉首尾空白后不允许为空，
   * 作者去掉首尾空白后为空则存 null，避免库里同时存在 '' 和 null 两种"无作者"。
   */
  private async updateBook(req: BookUpdateRequest): Promise<BookEntity> {
    const row = this.bookRepo.findById(req.id);
    if (!row) {
      throw new Error(`BookEntity not found: ${req.id}`);
    }

    const meta: Pick<BookEntity, 'booksName' | 'author'> = {
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
      this.bookRepo.updateMeta(req.id, meta);
    }

    if (req.cover !== undefined) {
      await this.replaceCover(req.id, req.cover, row.coverAttachment);
    }

    const updated = this.bookRepo.findById(req.id);
    if (!updated) {
      throw new Error(`BookEntity not found after update: ${req.id}`);
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
      this.bookRepo.updateCoverAttachment(bookId, null);
      await this.attachmentService.deleteAttachments(oldAttachmentId ? [oldAttachmentId] : []);
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
    this.bookRepo.updateCoverAttachment(bookId, attachmentId);
    if (oldAttachmentId && oldAttachmentId !== attachmentId) {
      await this.attachmentService.deleteAttachments([oldAttachmentId]);
    }
  }

  /** 把封面字节登记为附件并返回附件 id；扩展名只用于推断 MIME，实际类型由附件服务按文件头兜底 */
  private async storeCoverAttachment(bytes: Uint8Array, ext: string): Promise<string> {
    const mimeType = imageMimeTypeFromExtension(ext) ?? '';
    const [stored] = await this.attachmentService.storeImages([{ bytes, mimeType }]);
    if (!stored) {
      throw new Error('封面写入附件失败');
    }
    return stored.attachmentId;
  }

  /** 读取书籍源文件大小（字节）；文件缺失时返回 null，不影响列表展示 */
  private readBookFileSize(row: BookEntity): number | null {
    const storeName = this.bookRepo.findStoreName(row.id);
    if (!storeName) return null;
    try {
      return fs.statSync(path.join(this.bookDir, storeName)).size;
    } catch (e) {
      log.warn(`[BookService] stat book file failed (${storeName}):`, e);
      return null;
    }
  }
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
    log.warn(`[BookService] PDF 文本层读取失败，按扫描版处理：${filePath}`, e);
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
