import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { resourceTable } from './resource';

/** 扫描版 PDF 的 OCR 页块；其它格式不写这张表。 */
export const resourceOcrPageTable = sqliteTable(
  'resource_ocr_page',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resourceTable.id, { onDelete: 'cascade' }),
    /** 页号，从 1 开始。 */
    page: integer().notNull(),
    /** 页块 JSON：`BookPageBlock[]`。 */
    blocks: text().notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [primaryKey({ columns: [table.resourceId, table.page] })]
);

export type ResourceOcrPageRow = typeof resourceOcrPageTable.$inferSelect;
export type InsertResourceOcrPageRow = typeof resourceOcrPageTable.$inferInsert;

export const resourceOcrPageSQL = `
CREATE TABLE IF NOT EXISTS resource_ocr_page (
  resource_id TEXT    NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  blocks      TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (resource_id, page)
);
`;
