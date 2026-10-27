import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import { dialog, ipcMain } from 'electron';
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
} from '@shared/types/books';
import {
  IMAGE_EXTENSIONS,
  imageMimeTypeFromExtension,
  resolveImageExtension,
} from '@shared/utils/file-util';
import { BaseService } from '@main/service';
import { attachmentService } from '@main/service/attachment-service';
import type { EmbedStartRequest } from '@shared/types/embedding';
import type { OcrCommandResult, OcrEvent } from '@shared/types/ocr';
import { Constants } from '../constants';
import { bookRepo, bookStageRepo } from '../db/repo';
import type { BookRow, InsertBookRow } from '../db/schema';
import { getMainWindow } from '../window';
import { BookEmbeddingRunner } from './etl/embedding';
import { clearBookContent, importBookFromFile, rechunkBook } from './book-content';
import { disposeBookCache } from './book-reader';
import { BookOcrRunner } from './ocr-runner';
import { toAttachmentUrl, toBook } from './util';

/** 封面图片体积上限 */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/**
 * 书籍的 IPC 门面：列表与详情、导入、改名换封面、删除，以及两个后台流水线的入口。
 *
 * 源文件、封面与插图附件、OCR 临时切片分别落在 Constants.dataDir 下的 books/、
 * attachment/image/ 与 ocr-work/。这里只做编排，不直接写分片、不解析 EPUB。
 */
export class BookService extends BaseService {
  /** 用户书籍根目录，书籍源文件都落在它下面 */
  readonly bookDir: string;

  /** 向量化任务编排。每本书一条独立任务，不排队 */
  private readonly embeddingRunner: BookEmbeddingRunner;

  /** 文字提取（OCR）的编排。同一时刻只跑一本书 */
  private readonly ocrRunner: BookOcrRunner;

  constructor() {
    super();
    this.bookDir = Constants.booksDir;
    this.embeddingRunner = new BookEmbeddingRunner({
      onRuntime: runtime => {
        getMainWindow()?.webContents.send(IpcChannel.Book_EmbeddingRuntime, runtime);
      },
    });
    this.ocrRunner = new BookOcrRunner((event: OcrEvent) => {
      getMainWindow()?.webContents.send(IpcChannel.Book_OcrEvent, event);
    });
  }

  /**
   * 注册书籍相关 IPC 处理器
   */
  setupIpcHandlers(): void {
    // 书籍 embedding 操作。暂停 / 继续 / 取消都按书定位：多本书可以同时跑
    ipcMain.handle(IpcChannel.Book_EmbeddingStart, (_event, req: EmbedStartRequest) =>
      this.embeddingRunner.start(req)
    );
    ipcMain.handle(IpcChannel.Book_EmbeddingPause, (_event, req: { bookId: string }) =>
      this.embeddingRunner.pause(req.bookId)
    );
    ipcMain.handle(IpcChannel.Book_EmbeddingResume, (_event, req: { bookId: string }) =>
      this.embeddingRunner.resume(req.bookId)
    );
    ipcMain.handle(IpcChannel.Book_EmbeddingCancel, (_event, req: { bookId: string }) =>
      this.embeddingRunner.cancel(req.bookId)
    );
    ipcMain.handle(IpcChannel.Book_EmbeddingDescribe, () => this.embeddingRunner.describe());

    // 文字提取：开始 / 取消 / 取运行态。重新提取的失效链在 runner 里完成
    ipcMain.handle(IpcChannel.Book_OcrStart, (_event, req: { bookId: string; restart?: boolean }) =>
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
          // 解析缓存必须先失效，否则阅读侧还会用旧的解析结果
          disposeBookCache(req.id);
          const chunks = await rechunkBook(req.id);
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

  /** 导入入口：正文与书行由 book-content 生成，封面由这里登记（附件归书籍元信息管）。 */
  private async importBook(srcFilePath: string): Promise<BookRow> {
    const { row, cover } = await importBookFromFile(srcFilePath);
    if (!cover) return row;

    const attachmentId = await this.storeCoverAttachment(cover.bytes, cover.ext);
    bookRepo.updateCoverAttachment(row.id, attachmentId);
    row.coverAttachment = attachmentId;
    return row;
  }

  /**
   * 删除一本书：内容、封面附件、源文件、书籍记录。
   * 文件删除失败仅记录日志，不影响 DB 删除（DB 是 UI 可见状态的唯一来源）。
   */
  private async deleteBook(id: string): Promise<void> {
    const row = bookRepo.findById(id);
    if (!row) {
      throw new Error(`Book not found: ${id}`);
    }

    disposeBookCache(id);
    // 页块、分片、向量与插图附件都由 book-content 清；封面是书籍元信息，由这里删
    await clearBookContent(id);
    await attachmentService.deleteAttachments(row.coverAttachment ? [row.coverAttachment] : []);

    try {
      fs.unlinkSync(path.join(this.bookDir, row.booksStoreName));
    } catch (e) {
      log.warn(`[BookService] deleteBook: book file not found (${row.booksStoreName}):`, e);
    }

    bookRepo.delete(id);
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
      disposeBookCache(bookId);
      await clearBookContent(bookId);
    }
    return this.ocrRunner.start(bookId);
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
}

export const bookService = new BookService();
