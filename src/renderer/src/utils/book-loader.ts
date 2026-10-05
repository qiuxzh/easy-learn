import type { BookEntity } from '@shared/types/books';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';

/**
 * BookLoader — 渲染端的薄包装，把前端 File / fetch 拿到的 ArrayBuffer 转成项目内的 BookEntity。
 *
 * 复用 `@shared/book-parser` 提供的 foliate-js + JSZip 解析逻辑。
 * 浏览器环境无需 copyBlob（默认 false）；主进程 jsdom 场景在 main/books/BookParser.ts 传 true。
 *
 * TODO: 后续要扩展 PDF/MOBI 等格式，在 shared/bookParser 旁加 parsePdf/parseMobi 即可。
 */
export class BookLoader {
  private static readonly ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

  constructor(private readonly buffer: ArrayBuffer) {}

  /** 解析为完整 BookEntity（id 留空，由调用方/后端覆盖） */
  async load(): Promise<Omit<BookEntity, 'id'>> {
    BookLoader.assertEpub(this.buffer);
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

  /** 校验 buffer 非空且前 4 字节是 ZIP 魔数（即 EPUB） */
  private static assertEpub(buffer: ArrayBuffer): void {
    if (buffer.byteLength === 0) throw new Error('Buffer is empty');
    const head = new Uint8Array(buffer.slice(0, 4));
    const isZip = BookLoader.ZIP_MAGIC.every((byte, i) => head[i] === byte);
    if (!isZip) throw new Error('Unsupported file format: not a ZIP/EPUB');
  }
}

// ---- 缓存 + 加载入口 ----

/**
 * 内存缓存：bookId → 已解析的 BookEntity。
 * 同一本书被多个 tab 打开时复用，避免重复 fetch + foliate-js 解析。
 *
 * TODO: 后续需要 LRU 或内存上限等过期/淘汰机制（书架书多时会持续占内存）。
 */
const bookCache = new Map<string, BookEntity>();

/**
 * 加载并返回完整 BookEntity。
 * 优先从缓存返回；缓存未命中时调主进程拿 app:// → fetch → foliate-js 解析 → 写回缓存。
 * 失败原因：主进程返回失败、网络异常、非 EPUB、foliate 解析异常。
 */
export async function loadBookEntity(bookId: string): Promise<BookEntity> {
  const cached = bookCache.get(bookId);
  if (cached) return cached;

  const getRes = await window.api.getBook(bookId);
  if (!getRes.success || !getRes.url || !getRes.type) {
    throw new Error(getRes.error ?? '获取书籍路径失败');
  }

  const buffer = await (await fetch(getRes.url)).arrayBuffer();
  const entityBody = await new BookLoader(buffer).load();
  const fullEntity: BookEntity = { ...entityBody, id: bookId };

  bookCache.set(bookId, fullEntity);
  return fullEntity;
}
