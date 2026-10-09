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
  BookUpdateRequest,
  BookUpdateResult,
  CoverImage,
  TOCItem,
} from '@shared/types/books';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';
import {
  clampReadLength,
  clampReadOffset,
  clipDocumentRange,
  extractSegmentText,
  findNextTocItem,
  findTocById,
  resolveAnchorElement,
  resolveNextTocAnchorElement,
  toBook,
  toResultToc,
} from './util';
import { BaseService } from '../service/base-service';
import { Constants } from '../constants';
import { runInTransaction } from '../db';
import { bookChunkRepo, bookEmbeddingRepo, bookRepo } from '../db/repo';
import type { BookRow, InsertBookChunkRow, InsertBookRow } from '../db/schema';
import { getMainWindow } from '../window';
import { BookEmbeddingQueue } from './etl/embedding';
import type { EmbedStartRequest } from '@shared/types/embedding';
import { initFoliatePolyfill } from './foliate-polyfill';
import { parseEpubFile } from './book-parser';
import {
  DEFAULT_CHUNK_OPTIONS,
  chunkDocument,
  createEpubSource,
  type ChunkDraft,
} from './etl/chunking';
import { bookBm25SearchService } from './book-bm25';

/** 章节正文分段读取的默认起始下标。 */
export const DEFAULT_READ_OFFSET = 0;
/** 章节正文分段读取的默认长度。 */
export const DEFAULT_READ_LENGTH = 12000;
/** 章节正文单次读取的硬上限，防止超长章节塞爆 LLM 上下文窗口。 */
export const MAX_READ_LENGTH = 30000;

/** 允许用作封面的图片扩展名。白名单同时用于校验用户传入的扩展名，避免被拼进路径 */
const COVER_EXTENSIONS: string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

/** 封面图片体积上限 */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/**
 * 归一化封面扩展名：去掉前导点、统一小写。
 * 不在白名单内时返回 null，调用方按不支持处理。
 */
function normalizeCoverExt(ext: string): string | null {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return COVER_EXTENSIONS.includes(normalized) ? normalized : null;
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
 * - books/{booksStoreName}         拷贝后的源 epub 文件
 * - books/cover/{id}{ext}          导入时从元信息抽出的封面图
 * - books/cover/{id}-{时间戳}{ext}  用户手动更换的封面图（带时间戳避免命中旧图缓存）
 * - DB 中存 books + book_chunks 两张表，book_chunks 没有级联删除，必须显式清理
 */
export class BookService extends BaseService {
  /** 用户书籍根目录，所有书籍文件和封面都以此为前缀 */
  bookDir: string;
  /** 解析后的 FoliateBook 缓存，key 是 bookId。
   *  简单 Map（无 LRU）：deleteBook / app 退出时清空；导入新书不清旧缓存。
   *  单本解析约 100-500ms，缓存命中后 readBookTocText 几乎零开销。 */
  private parsedBookCache = new Map<string, ParsedBookCacheEntry>();

  /** 向量化任务队列。运行态只活在它里面，不落库 */
  private readonly embeddingQueue: BookEmbeddingQueue;

  constructor() {
    super();
    this.bookDir = path.resolve(Constants.dataDir, 'books');
    this.embeddingQueue = new BookEmbeddingQueue({
      onRuntime: runtime => {
        getMainWindow()?.webContents.send(IpcChannel.Book_EmbeddingRuntime, runtime);
      },
    });
  }

  /**
   * 启动时按向量表对账进度行。
   *
   * 进度行是派生的，向量表才是事实源。换过表结构、或者手工改过库之后两者可能对不上，
   * 这里按书补齐，幂等。
   */
  onInit(): void {
    bookEmbeddingRepo.reconcile();
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

    ipcMain.handle(IpcChannel.Book_PickAndImport, async (): Promise<BookImportResult> => {
      try {
        const picked = await this.pickEpubFile();
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
        // 一次查完全部向量化信息，避免按书逐个查询
        const embeddings = bookEmbeddingRepo.loadAll(rows.map(row => row.id));
        return {
          success: true,
          books: rows.map(row => toBook(row, this.readBookFileSize(row), embeddings[row.id])),
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
          return { success: true, url, type: row.booksType };
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
          const row = this.updateBook(req);
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

  /** 弹出文件选择框，返回用户选择的 EPUB 路径，取消选择则返回 null */
  /**
   * 把一行书籍记录转成渲染端实体，顺带查它的向量化信息。
   * 批量路径不要用它——那里先用 `loadAll` 一次查完，避免按书逐个查询。
   */
  private toBookDoc(row: BookRow): BookDoc {
    return toBook(row, this.readBookFileSize(row), bookEmbeddingRepo.load(row.id));
  }

  private async pickEpubFile(): Promise<{ filePath: string } | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'EPUB 文件', extensions: ['epub'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { filePath: result.filePaths[0] };
  }

  /**
   * 导入一本书（main 端完成解析 + 写库）：
   * 1. 解析 EPUB 并生成带 CFI 的正文分片
   * 2. 确保 bookDir / cover 目录存在
   * 3. 写 DB 元信息和分片数据
   * 4. 保存 cover（如有）
   * 5. 拷贝源文件到 bookDir/{booksStoreName}
   */
  private async importBook(srcFilePath: string): Promise<BookRow> {
    // 1. 解析 EPUB 并生成可检索的正文分片
    const id = crypto.randomUUID();
    const info = await parseEpubFile(srcFilePath);
    // Chunk 化失败不影响导入，chunks 留空表示该书没有可检索分片
    let chunks: InsertBookChunkRow[] = [];
    try {
      const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
      chunks = toChunkRows(id, drafts);
    } catch (e) {
      log.error(`[BookService] chunkDocument failed, book imported without chunks: ${id}`, e);
    }

    // 2. 确保目录存在
    fs.mkdirSync(this.bookDir, { recursive: true });
    fs.mkdirSync(path.join(this.bookDir, 'cover'), { recursive: true });

    // 3. 写入元信息
    const booksStoreName = `${id}.epub`;
    const row = bookRepo.create({
      id,
      booksName: info.title || path.basename(srcFilePath, path.extname(srcFilePath)),
      booksStoreName,
      booksType: 'epub',
      coverImg: null,
      totalChapters: info.totalChapters ?? null,
      description: null,
      author: info.author ?? null,
    });

    // 4. 写入正文分片
    try {
      // books 和 book_chunks 都在本函数同步写入，DB 端靠 bookId 关联。
      // chunks 写入失败需要回滚 books 记录，避免出现"有书无文"的孤儿状态。
      bookChunkRepo.createMany(chunks);
      // 同一 ID 的 Chunk 重新生成时，确保后续检索不会继续使用旧索引。
      bookBm25SearchService.invalidateBook(id);
    } catch (e) {
      bookChunkRepo.deleteByBookId(id);
      bookRepo.delete(id);
      throw e;
    }

    // 5. 保存 cover（如有）
    if (info.cover) {
      const coverRelPath = `books/cover/${id}${info.cover.ext}`;
      fs.writeFileSync(
        path.join(this.bookDir, 'cover', `${id}${info.cover.ext}`),
        Buffer.from(info.cover.bytes)
      );
      bookRepo.updateCoverImg(id, coverRelPath);
      row.coverImg = coverRelPath;
    }

    // 6. 拷贝源文件
    fs.copyFileSync(srcFilePath, path.join(this.bookDir, booksStoreName));

    return row;
  }
  /**
   * 删除一本书：
   * 1. 查询 DB 拿到书籍记录
   * 2. 删除封面文件（如有）
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

    this.removeCoverFile(row.coverImg);

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
    bookBm25SearchService.invalidateBook(id);
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

    const sourcePath = path.join(this.bookDir, row.booksStoreName);
    const info = await parseEpubFile(sourcePath);
    const drafts = await chunkDocument(createEpubSource(info.rawBook), DEFAULT_CHUNK_OPTIONS);
    const chunks = toChunkRows(id, drafts);

    runInTransaction(() => {
      bookChunkRepo.deleteByBookId(id);
      bookChunkRepo.createMany(chunks);
    });
    bookEmbeddingRepo.drop(id, null);

    this.parsedBookCache.delete(id);
    bookBm25SearchService.invalidateBook(id);
    return chunks.length;
  }

  /**
   * 更新书籍信息（书名 / 作者 / 封面），返回更新后的行。
   * 未出现在请求里的字段保持不变；书名去掉首尾空白后不允许为空，
   * 作者去掉首尾空白后为空则存 null，避免库里同时存在 '' 和 null 两种"无作者"。
   */
  private updateBook(req: BookUpdateRequest): BookRow {
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
      this.replaceCover(req.id, req.cover, row.coverImg);
    }

    const updated = bookRepo.findById(req.id);
    if (!updated) {
      throw new Error(`Book not found after update: ${req.id}`);
    }
    return updated;
  }

  /**
   * 替换或移除封面：cover 为 null 表示移除。
   * 新封面使用带时间戳的文件名，避免沿用同名文件时被浏览器缓存命中而仍显示旧图；
   * 数据库写入成功后再删除旧封面文件。
   */
  private replaceCover(bookId: string, cover: CoverImage | null, oldCoverImg: string | null): void {
    if (!cover) {
      bookRepo.updateCoverImg(bookId, null);
      this.removeCoverFile(oldCoverImg);
      return;
    }

    const ext = normalizeCoverExt(cover.ext);
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

    const coverRelPath = `books/cover/${bookId}-${Date.now()}${ext}`;
    fs.mkdirSync(path.join(this.bookDir, 'cover'), { recursive: true });
    fs.writeFileSync(path.join(Constants.dataDir, coverRelPath), bytes);

    bookRepo.updateCoverImg(bookId, coverRelPath);
    if (oldCoverImg && oldCoverImg !== coverRelPath) {
      this.removeCoverFile(oldCoverImg);
    }
  }

  /** 删除封面文件；文件缺失只记日志，不影响数据库状态 */
  private removeCoverFile(coverRelPath: string | null): void {
    if (!coverRelPath) return;
    try {
      fs.unlinkSync(path.join(Constants.dataDir, coverRelPath));
    } catch (e) {
      log.warn(`[BookService] cover file not found (${coverRelPath}):`, e);
    }
  }

  /**
   * 弹出文件选择框读取封面图片的字节与扩展名（不落盘）。
   * 渲染层拿到字节后用 Blob URL 预览，用户点击保存时才真正写入磁盘。
   */
  private async pickCoverFile(): Promise<CoverImage | null> {
    const result = await dialog.showOpenDialog({
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: COVER_EXTENSIONS }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const ext = normalizeCoverExt(path.extname(filePath));
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

      const fullText = extractSegmentText(doc);
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
   * 拿 bookId 对应的解析后 EPUB。
   * 命中缓存直接返回；未命中则读 DB 拿到路径 → 读文件 → parseEpubFromBuffer → 写入缓存。
   * 解析失败（文件丢失 / epub 损坏）返回 null，调用方负责降级（空 TOC / 空章节）。
   */
  private async getParsedBook(bookId: string): Promise<ParsedBookCacheEntry | null> {
    const cached = this.parsedBookCache.get(bookId);
    if (cached) {
      return cached;
    }

    const row = bookRepo.findById(bookId);
    if (!row) return null;

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
 * 把格式无关的切分产物映射为 book_chunk 行，并补上书籍维度与主键。
 *
 * segment 与 locator 都是格式中立命名：EPUB 的 segment 是 spine section，
 * locator 是 CFI 或节级兜底定位串；后续 HTML / PDF 源复用同一张表。
 */
function toChunkRows(bookId: string, drafts: ChunkDraft[]): InsertBookChunkRow[] {
  return drafts.map(draft => ({
    id: `${bookId}:${draft.segmentIndex}:${draft.chunkIndex}`,
    bookId,
    segmentIndex: draft.segmentIndex,
    segmentId: draft.segmentId,
    chunkIndex: draft.chunkIndex,
    content: draft.content,
    locatorStart: draft.locatorStart,
    locatorEnd: draft.locatorEnd,
  }));
}

export const bookService = new BookService();
