import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { bookTable } from './book';

/**
 * OCR 提取出的逐页内容。
 *
 * 只存识别结果：有文本层的 PDF 不需要这张表，它的文字直接从文件读。
 * 行存在即表示该页已识别，空 `blocks` 表示空白页——不需要状态列。
 *
 * `blocks` 是 `BookPageBlock[]` 的 JSON：文字块与图片块按阅读顺序排在一起，
 * 图片块只存附件 id，坐标在合并排序后即丢弃。
 */
export const bookPageTable = sqliteTable(
  'book_page',
  {
    /** 所属书籍 */
    bookId: text('book_id')
      .notNull()
      .references(() => bookTable.id, { onDelete: 'cascade' }),
    /** 页码，从 1 开始；与 `pdf:<页>` 定位串一致 */
    page: integer('page').notNull(),
    /** 块数组的 JSON（见 shared/types/ocr 的 BookPageBlock） */
    blocks: text('blocks').notNull(),
    /** 最近一次写入时间 */
    updatedAt: integer('updated_at').notNull(),
  },
  table => [primaryKey({ columns: [table.bookId, table.page] })]
);

export type BookPageRow = typeof bookPageTable.$inferSelect;
export type InsertBookPageRow = typeof bookPageTable.$inferInsert;

export const bookPageSQL = `
CREATE TABLE IF NOT EXISTS book_page (
  book_id    TEXT    NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  page       INTEGER NOT NULL,
  blocks     TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, page)
);
`;
