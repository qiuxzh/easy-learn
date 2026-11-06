import { IpcChannel } from '@shared/ipc-channels';
import type { EmbedStartRequest } from '@shared/types/embedding';
import type {
  BookDeleteRequest,
  BookGetRequest,
  BookImportResult,
  BookPickCoverResult,
  BookUpdateRequest,
} from '@shared/types/books';
import type { BookService } from '@main/books/book-service';
import type { BookEmbeddingRunner } from '@main/books/etl/embedding';
import type { BookOcrRunner } from '@main/books/ocr-runner';
import { pickBookFile, pickCoverImage } from './dialogs';
import { registerDirectHandler } from './register-handler';

/**
 * 注册书籍相关通道。
 *
 * 返回体自带 `success` 字段，渲染层按原样判断，因此不套统一信封。
 *
 * @param book 装配根持有的书籍服务
 * @param embeddingService 向量化任务编排
 * @param ocrService 文字提取编排
 */
export function registerBookHandlers(
  book: BookService,
  embeddingService: BookEmbeddingRunner,
  ocrService: BookOcrRunner
): void {
  // 向量化：暂停 / 继续 / 取消都按书定位，多本书可以同时跑
  registerDirectHandler(IpcChannel.Book_EmbeddingStart, (request: EmbedStartRequest) =>
    embeddingService.start(request)
  );
  registerDirectHandler(IpcChannel.Book_EmbeddingPause, (request: { bookId: string }) =>
    embeddingService.pause(request.bookId)
  );
  registerDirectHandler(IpcChannel.Book_EmbeddingResume, (request: { bookId: string }) =>
    embeddingService.resume(request.bookId)
  );
  registerDirectHandler(IpcChannel.Book_EmbeddingCancel, (request: { bookId: string }) =>
    embeddingService.cancel(request.bookId)
  );
  registerDirectHandler(IpcChannel.Book_EmbeddingDescribe, () => embeddingService.describe());

  // 文字提取：重新提取的失效链在 BookService 里完成
  registerDirectHandler(
    IpcChannel.Book_OcrStart,
    (request: { bookId: string; restart?: boolean }) =>
      book.startOcr(request.bookId, request.restart === true)
  );
  registerDirectHandler(IpcChannel.Book_OcrCancel, () => ocrService.cancel());
  registerDirectHandler(IpcChannel.Book_OcrDescribe, () => ocrService.describe());

  registerDirectHandler(IpcChannel.Book_PickAndImport, async (): Promise<BookImportResult> => {
    try {
      const filePath = await pickBookFile();
      if (!filePath) return { success: false, canceled: true };
      return book.importFile(filePath);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  registerDirectHandler(IpcChannel.Book_GetAllBooks, () => book.listBooks());
  registerDirectHandler(IpcChannel.Book_DeleteBook, (request: BookDeleteRequest) =>
    book.removeBook(request.id)
  );
  registerDirectHandler(IpcChannel.Book_GetBook, (request: BookGetRequest) =>
    book.getBookDetail(request.id)
  );
  registerDirectHandler(IpcChannel.Book_PickCover, async (): Promise<BookPickCoverResult> => {
    try {
      const cover = await pickCoverImage();
      if (!cover) return { success: false, canceled: true };
      return { success: true, cover };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  registerDirectHandler(IpcChannel.Book_UpdateBook, (request: BookUpdateRequest) =>
    book.updateBookInfo(request)
  );
  registerDirectHandler(IpcChannel.Book_RechunkBook, (request: BookGetRequest) =>
    book.rechunkBook(request.id)
  );
}
