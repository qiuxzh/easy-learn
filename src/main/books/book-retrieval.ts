/**
 * 书籍检索的装配层。
 *
 * 检索算法在 `@main/retrieval`，它不认识书籍、也不认识数据库；本文件是两者的接缝：
 * 提供「按书取文档」的加载器，并把内存索引的失效时机接到书籍的写路径上。
 */
import { bookChunkRepo } from '@main/db/repo';
import type { BookChunkRow } from '@main/db/schema';
import { Bm25Retriever } from '@main/retrieval/bm25/retriever';
import type { RetrievalHit } from '@main/retrieval/types';

/** 书籍检索的命中类型。工具层用它，不必去认数据库行类型。 */
export type BookRetrievalHit = RetrievalHit<BookChunkRow>;

/**
 * 书籍 BM25 检索器。
 *
 * `BookChunkRow` 在结构上就满足 `RetrievalDocument`，所以加载器直接返回数据库行、
 * 不需要中间映射——命中里带的就是完整行，工具层要的定位串也一起回来了。
 * `findByBookId` 按阅读顺序返回，正好是索引同分排序需要的兜底顺序。
 */
const bm25Retriever = new Bm25Retriever<BookChunkRow>({
  load: bookId => bookChunkRepo.findByBookId(bookId),
});

/** 在指定书籍中做 BM25 检索。 */
export function searchBookBm25(
  bookId: string,
  query: string,
  topK: number
): Promise<BookRetrievalHit[]> {
  return bm25Retriever.search(bookId, query, topK);
}

/**
 * 丢弃某本书的内存检索索引。
 *
 * 删除书籍、重新分片、重新导入之后调用：这些操作会让已建好的索引与库里的数据不再一致，
 * 而索引不会自己发现这件事。
 */
export function invalidateBookRetrieval(bookId: string): void {
  bm25Retriever.invalidate(bookId);
}
