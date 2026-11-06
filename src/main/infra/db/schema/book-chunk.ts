import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 书籍正文分片表，用于 BM25 等检索能力。 */
export const bookChunkTable = sqliteTable('book_chunk', {
  /** 由书籍、segment 和 Chunk 顺序组成的稳定标识。 */
  id: text().primaryKey(),
  /** 所属书籍，用于按书建立检索索引和清理数据。 */
  bookId: text('book_id').notNull(),
  /** 文档单元在阅读顺序中的下标（EPUB 是 spine 下标），作为定位串异常时的单元级降级。 */
  segmentIndex: integer('segment_index').notNull(),
  /** 文档单元的稳定标识（EPUB 是 foliate-js section ID 与内部 href，PDF 是页号）。 */
  segmentId: text('segment_id').notNull(),
  /** 当前 segment 内的稳定顺序。 */
  chunkIndex: integer('chunk_index').notNull(),
  /** 经空白清理后的正文，作为后续 BM25 的检索文档。 */
  content: text().notNull(),
  /** 命中后阅读器应跳转到的位置，自带 scheme 前缀（EPUB 是 CFI 或 epubsec 兜底定位）。 */
  locatorStart: text('locator_start').notNull(),
  /** 为命中高亮和上下文范围扩展保留的结束位置。 */
  locatorEnd: text('locator_end').notNull(),
});

export type BookChunkRow = typeof bookChunkTable.$inferSelect;
export type InsertBookChunkRow = typeof bookChunkTable.$inferInsert;

export const bookChunkSQL = `
  CREATE TABLE IF NOT EXISTS book_chunk (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    segment_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    locator_start TEXT NOT NULL,
    locator_end TEXT NOT NULL,
    UNIQUE(book_id, segment_index, chunk_index)
  );
`;

export const bookChunkBookIdIndexSQL = `
  CREATE INDEX IF NOT EXISTS book_chunk_book_id_idx ON book_chunk(book_id);
`;
