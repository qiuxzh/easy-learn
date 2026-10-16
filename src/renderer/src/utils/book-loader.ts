import type { BookEntity } from '@shared/types/books';
import { extractAuthor, flattenToc, parseEpubFromBuffer } from '@shared/utils/book-parser';
import type { FoliateBook } from '@/components/reader/foliate-types';
import { useBooksStore } from '@/stores/books-store';
import { makePdfBook, renderPdfCoverJpeg } from './pdf-book';

/** 靠文件头识别出的容器格式 */
type DetectedFormat = 'epub' | 'pdf';

/**
 * BookLoader — 渲染端的薄包装，把前端 File / fetch 拿到的 ArrayBuffer 转成项目内的 BookEntity。
 *
 * EPUB 复用 `@shared/book-parser` 的 foliate-js + JSZip 解析逻辑；
 * PDF 走本目录的 pdf-book 适配层（pdf.js → foliate 固定版式 Book）。
 * 浏览器环境无需 copyBlob（默认 false）；主进程 jsdom 场景在 main/books/book-parser.ts 传 true。
 */
export class BookLoader {
  private static readonly ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
  private static readonly PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

  constructor(
    private readonly buffer: ArrayBuffer,
    /** 书籍名。PDF 元信息缺标题时用它兜底（EPUB 走自身元信息） */
    private readonly fileName = ''
  ) {}

  /** 解析为完整 BookEntity（id 留空，由调用方/后端覆盖） */
  async load(): Promise<Omit<BookEntity, 'id'>> {
    if (this.buffer.byteLength === 0) throw new Error('Buffer is empty');

    switch (BookLoader.detectFormat(this.buffer)) {
      case 'epub':
        return this.loadEpub();
      case 'pdf':
        return this.loadPdf();
      default:
        throw new Error('Unsupported file format: neither ZIP/EPUB nor PDF');
    }
  }

  /** 解析 EPUB：foliate-js 的 EPUB + JSZip */
  private async loadEpub(): Promise<Omit<BookEntity, 'id'>> {
    const parsed = await parseEpubFromBuffer(this.buffer);
    return {
      type: 'epub',
      tocs: parsed.tocs,
      rawBook: parsed.rawBook,
      metadata: {
        title: parsed.metadata.title,
        author: parsed.metadata.author,
        // 渲染端不直接显示原始封面字节，统一从后端 DB 取 app:// 协议的封面 URL
        cover: undefined,
        type: 'epub',
      },
    };
  }

  /** 解析 PDF：走 pdf.js 适配层，产出 foliate 的固定版式 Book */
  private async loadPdf(): Promise<Omit<BookEntity, 'id'>> {
    const rawBook = await makePdfBook(this.buffer, this.fileName);
    return {
      type: 'pdf',
      tocs: flattenToc(rawBook.toc ?? []),
      rawBook,
      metadata: {
        title: metadataTitle(rawBook, this.fileName),
        author: extractAuthor(rawBook.metadata),
        cover: undefined,
        type: 'pdf',
      },
    };
  }

  /** 按文件头判断格式（ZIP / PDF 都不是时返回 null） */
  private static detectFormat(buffer: ArrayBuffer): DetectedFormat | null {
    const head = new Uint8Array(buffer.slice(0, 5));
    const startsWith = (magic: readonly number[]): boolean =>
      magic.every((byte, index) => head[index] === byte);

    if (startsWith(BookLoader.ZIP_MAGIC)) return 'epub';
    if (startsWith(BookLoader.PDF_MAGIC)) return 'pdf';
    return null;
  }
}

/** 元信息标题可能是字符串或多语言对象，统一成字符串；空则回退文件名 */
function metadataTitle(rawBook: FoliateBook, fallback: string): string {
  const title = rawBook.metadata.title;
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object') {
    const first = Object.values(title).find((value): value is string => typeof value === 'string');
    if (first) return first;
  }
  return fallback;
}

// ---- 缓存 + 加载入口 ----

/**
 * 内存缓存：bookId → 已解析的 BookEntity。
 * 同一本书被多个 tab 打开时复用，避免重复 fetch + 解析。
 *
 * 注意：PDF 的 BookEntity 持有 pdf.js 文档与 worker 连接，缓存不淘汰就意味着它们一直活着。
 * TODO: 后续需要 LRU 或内存上限等过期/淘汰机制（书架书多时会持续占内存）。
 */
const bookCache = new Map<string, BookEntity>();

/**
 * 首次打开 PDF 时补生成封面。
 *
 * 导入流程不解析文件（主进程因此不需要 PDFium / canvas 这类原生依赖），
 * 封面改成这里用已加载的 pdf.js 渲染首页 → 回写主进程 → 刷新书架。
 * 失败只记日志：没有封面不影响阅读。
 */
async function savePdfCover(bookId: string, entity: BookEntity): Promise<void> {
  try {
    const bytes = await renderPdfCoverJpeg(entity.rawBook);
    if (!bytes) return;
    await window.api.updateBook({ id: bookId, cover: { bytes, ext: 'jpg' } });
    await useBooksStore.getState().loadBooks();
  } catch (error) {
    console.warn('[book-loader] 生成 PDF 封面失败', error);
  }
}

/**
 * 加载并返回完整 BookEntity。
 * 优先从缓存返回；缓存未命中时调主进程拿 app:// → fetch → 解析 → 写回缓存。
 * 失败原因：主进程返回失败、网络异常、格式不支持、解析异常。
 */
export async function loadBookEntity(bookId: string): Promise<BookEntity> {
  const cached = bookCache.get(bookId);
  if (cached) return cached;

  const getRes = await window.api.getBook(bookId);
  if (!getRes.success || !getRes.url || !getRes.type) {
    throw new Error(getRes.error ?? '获取书籍路径失败');
  }

  const buffer = await (await fetch(getRes.url)).arrayBuffer();
  const entityBody = await new BookLoader(buffer, getRes.name ?? '').load();
  const fullEntity: BookEntity = { ...entityBody, id: bookId };

  bookCache.set(bookId, fullEntity);
  // 还没有封面的 PDF：借这次打开顺手生成（不阻塞加载，失败也不影响阅读）
  if (getRes.type === 'pdf' && !getRes.coverUrl) void savePdfCover(bookId, fullEntity);

  return fullEntity;
}
