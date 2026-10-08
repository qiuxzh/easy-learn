import { asc, eq } from 'drizzle-orm';
import { getDatabase } from '..';
import { bookChunkTable } from '../schema';
import type { InsertBookChunkRow } from '../schema';

/** 每行包含 8 个字段；限制批次大小以兼容 SQLite 的 SQL 参数上限。 */
const INSERT_BATCH_SIZE = 80;

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

  /** 删除指定书籍的全部正文分片。 */
  deleteByBookId(bookId: string): void {
    const db = getDatabase();
    db.delete(bookChunkTable).where(eq(bookChunkTable.bookId, bookId)).run();
  }
}

export const bookChunkRepo = new BookChunkRepo();
