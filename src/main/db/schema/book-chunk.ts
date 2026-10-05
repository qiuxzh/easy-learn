import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 书籍正文分片表，用于 BM25 等检索能力。 */
export const bookChunkTable = sqliteTable('book_chunk', {
  /** 由书籍、section 和 Chunk 顺序组成的稳定标识。 */
  id: text().primaryKey(),
  /** 所属书籍，用于按书建立检索索引和清理数据。 */
  bookId: text('book_id').notNull(),
  /** EPUB spine 中的 section 下标，作为 CFI 异常时的章节级降级定位。 */
  sectionIndex: integer('section_index').notNull(),
  /** foliate-js section ID，同时也是当前 EPUB 的内部 href。 */
  sectionId: text('section_id').notNull(),
  /** 阅读器可识别的 EPUB 内部路径。 */
  href: text().notNull(),
  /** 当前 section 内的稳定顺序。 */
  chunkIndex: integer('chunk_index').notNull(),
  /** 经空白清理后的正文，作为后续 BM25 的检索文档。 */
  content: text().notNull(),
  /** 命中后阅读器应跳转到的位置。 */
  startCfi: text('start_cfi').notNull(),
  /** 为命中高亮和上下文范围扩展保留的结束位置。 */
  endCfi: text('end_cfi').notNull(),
});

export type BookChunkRow = typeof bookChunkTable.$inferSelect;
export type InsertBookChunkRow = typeof bookChunkTable.$inferInsert;

export const bookChunkSQL = `
  CREATE TABLE IF NOT EXISTS book_chunk (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    section_index INTEGER NOT NULL,
    section_id TEXT NOT NULL,
    href TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_cfi TEXT NOT NULL,
    end_cfi TEXT NOT NULL,
    UNIQUE(book_id, section_index, chunk_index)
  );
`;

export const bookChunkBookIdIndexSQL = `
  CREATE INDEX IF NOT EXISTS book_chunk_book_id_idx ON book_chunk(book_id);
`;
