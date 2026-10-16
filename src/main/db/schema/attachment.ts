import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { v4 as uuidv4 } from 'uuid';

/**
 * 附件表
 * 只负责「id → 文件位置 + 元数据」的寻址，不记来源、不记归属
 */
export const attachmentTable = sqliteTable('attachment', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  /** 文件相对 dataDir 的路径，含扩展名 */
  path: text('path').notNull(),
  /** 附件种类，目前只有 image */
  type: text().notNull(),
  /** MIME 类型 */
  mimeType: text('mime_type').notNull(),
  /** 文件字节数 */
  size: integer('size').notNull(),
  /** 创建时间，Unix 毫秒 */
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type AttachmentRow = typeof attachmentTable.$inferSelect;
export type InsertAttachmentRow = typeof attachmentTable.$inferInsert;

export const attachmentSQL = `
CREATE TABLE IF NOT EXISTS attachment (
  id         TEXT    PRIMARY KEY,
  path       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  mime_type  TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
`;
