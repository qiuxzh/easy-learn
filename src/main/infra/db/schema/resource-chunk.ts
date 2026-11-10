import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { resourceTable } from './resource';

/** 资料的可检索分片；所有文本格式共用，未来稀疏索引从这里取正文。 */
export const resourceChunkTable = sqliteTable('resource_chunk', {
  id: text().primaryKey(),
  resourceId: text('resource_id')
    .notNull()
    .references(() => resourceTable.id, { onDelete: 'cascade' }),
  /** 资源内的分片序号，从 0 开始。 */
  idx: integer().notNull(),
  /** 分片正文，直接作为稀疏检索的输入。 */
  text: text().notNull(),
  /** 定位串，例如 `pdf:12`。 */
  locator: text(),
  /** 格式相关的补充信息 JSON。 */
  meta: text(),
  createdAt: integer('created_at').notNull(),
});

export type ResourceChunkRow = typeof resourceChunkTable.$inferSelect;
export type InsertResourceChunkRow = typeof resourceChunkTable.$inferInsert;

export const resourceChunkSQL = `
CREATE TABLE IF NOT EXISTS resource_chunk (
  id          TEXT    PRIMARY KEY,
  resource_id TEXT    NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  locator     TEXT,
  meta        TEXT,
  created_at  INTEGER NOT NULL
);
`;

/** 按资源读取分片，同时约束同一资源内的序号唯一。 */
export const resourceChunkResourceIdxUniqueSQL = `
CREATE UNIQUE INDEX IF NOT EXISTS resource_chunk_resource_idx_unique
  ON resource_chunk (resource_id, idx);
`;
