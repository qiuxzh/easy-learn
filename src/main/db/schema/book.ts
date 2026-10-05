import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { v4 as uuidv4 } from 'uuid';
import type { BookType } from '@shared/types/books';

/** 书库表：记录用户导入的每一本书 */
export const bookTable = sqliteTable('book', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  /** 书名（来自元信息或文件名） */
  booksName: text('books_name').notNull(),
  /** 文件底层存储名（含扩展名），运行时与 bookDir 拼接定位唯一文件 */
  booksStoreName: text('books_store_name').notNull(),
  /** 文件类型 */
  booksType: text('books_type').$type<BookType>().notNull(),
  /** 封面的相对路径（相对 dataDir），如 'books/cover/{id}.jpg'；空表示无封面。app:// 协议基于此路径直拼 */
  coverImg: text('cover_img'),
  totalPages: integer('total_pages'),
  totalChapters: integer('total_chapters'),
  description: text('description'),
  author: text('author'),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type BookRow = typeof bookTable.$inferSelect;
export type InsertBookRow = typeof bookTable.$inferInsert;

export const bookSQL = `
CREATE TABLE IF NOT EXISTS book (
  id TEXT PRIMARY KEY,
  books_name TEXT NOT NULL,
  books_store_name TEXT NOT NULL,
  books_type TEXT NOT NULL,
  cover_img TEXT,
  total_pages INTEGER,
  total_chapters INTEGER,
  description TEXT,
  author TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
`;
