import { asc, count, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '..';
import { bookChunkTable } from '../schema';
import type { BookChunkRow, InsertBookChunkRow } from '../schema';

/** 每行包含 8 个字段；限制批次大小以兼容 SQLite 的 SQL 参数上限。 */
const INSERT_BATCH_SIZE = 80;

/** 按书籍聚合的分片数量。 */
export interface BookChunkCount {
  bookId: string;
  count: number;
}

export class BookChunkRepo {
  /** 批量写入同一本书的正文分片，避免单次 SQL 参数过多。 */
  createMany(chunks: InsertBookChunkRow[]): void {
    if (chunks.length === 0) return;

    const db = getDatabase();
    // 导入长书时 Chunk 数量较多，分批写入以避免超过 SQLite 的绑定参数限制。
    for (let index = 0; index < chunks.length; index += INSERT_BATCH_SIZE) {
      db.insert(bookChunkTable)
        .values(chunks.slice(index, index + INSERT_BATCH_SIZE))
        .run();
    }
  }

  /** 按书籍和正文顺序读取全部 Chunk，用于构建该书的内存检索索引。 */
  findByBookId(bookId: string) {
    const db = getDatabase();
    return db
      .select()
      .from(bookChunkTable)
      .where(eq(bookChunkTable.bookId, bookId))
      .orderBy(asc(bookChunkTable.segmentIndex), asc(bookChunkTable.chunkIndex))
      .all();
  }

  /**
   * 按 id 批量取分片，用于检索命中后回查正文。
   *
   * **返回顺序不保证与传入一致**，调用方要自己按 id 回填来恢复顺序。
   * 命中数受工具的 topK 限制（≤10），不会逼近 SQLite 的参数上限。
   */
  findByIds(ids: string[]): BookChunkRow[] {
    if (ids.length === 0) return [];
    return getDatabase().select().from(bookChunkTable).where(inArray(bookChunkTable.id, ids)).all();
  }

  /**
   * 按阅读顺序取前 N 个分片。
   *
   * 首次为某个模型参数建索引时用：那一刻向量表还不存在，
   * 没法用「排除已有向量」的方式取待处理，而这批做完表就建好了。
   */
  listFirstByBookId(bookId: string, limit: number) {
    const db = getDatabase();
    return db
      .select()
      .from(bookChunkTable)
      .where(eq(bookChunkTable.bookId, bookId))
      .orderBy(asc(bookChunkTable.segmentIndex), asc(bookChunkTable.chunkIndex))
      .limit(limit)
      .all();
  }

  /** 删除指定书籍的全部正文分片。 */
  deleteByBookId(bookId: string): void {
    const db = getDatabase();
    db.delete(bookChunkTable).where(eq(bookChunkTable.bookId, bookId)).run();
  }

  /** 指定书籍的分片总数，作为向量化进度的分母。 */
  countByBookId(bookId: string): number {
    const row = getDatabase()
      .select({ count: count() })
      .from(bookChunkTable)
      .where(eq(bookChunkTable.bookId, bookId))
      .get();
    return row?.count ?? 0;
  }

  /**
   * 一次拿到全部书籍的分片数。
   * 书库列表与启动扫描都要用它当分母，逐本查询会变成 N+1。
   */
  aggregateCountsByBook(): BookChunkCount[] {
    return getDatabase()
      .select({ bookId: bookChunkTable.bookId, count: count() })
      .from(bookChunkTable)
      .groupBy(bookChunkTable.bookId)
      .all();
  }
}

export const bookChunkRepo = new BookChunkRepo();
