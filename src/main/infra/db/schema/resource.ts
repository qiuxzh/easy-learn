import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { ResourceFormat, ResourceKind } from '@shared/types/library';

/** 资料库条目表：目录与文件共用一棵树，文件行内联落盘位置与大小。 */
export const resourceTable = sqliteTable('resource', {
  id: text().primaryKey(),
  /** 父目录 id；顶层为 null。 */
  parentId: text('parent_id'),
  /** 条目类型。 */
  kind: text().$type<ResourceKind>().notNull(),
  /** 完整名称：文件含扩展名，文件夹即目录名。 */
  name: text().notNull(),
  /** 文件格式；文件夹为 null。 */
  format: text().$type<ResourceFormat>(),
  /** 文件相对 data 目录的路径；文件夹为 null。 */
  blobPath: text('blob_path'),
  /** 文件字节数；文件夹为 null。 */
  sizeBytes: integer('size_bytes'),
  /** 解析元数据 JSON（页数、是否有文本层等）；按需计算后缓存。 */
  docMeta: text('doc_meta'),
  /** 最近一次在阅读器中打开的时间，Unix 毫秒；从未打开为 null。 */
  lastOpenedAt: integer('last_opened_at'),
  /** 是否已收藏。 */
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  /** 创建时间，Unix 毫秒。 */
  createdAt: integer('created_at').notNull(),
  /** 最后修改时间，Unix 毫秒。 */
  updatedAt: integer('updated_at').notNull(),
});

export type ResourceRow = typeof resourceTable.$inferSelect;
export type InsertResourceRow = typeof resourceTable.$inferInsert;

export const resourceSQL = `
CREATE TABLE IF NOT EXISTS resource (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT,
  blob_path TEXT,
  size_bytes INTEGER,
  doc_meta TEXT,
  last_opened_at INTEGER,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export const resourceParentIndexSQL = `
CREATE INDEX IF NOT EXISTS resource_parent_id_index ON resource (parent_id);
`;

/** 同级重名约束；COALESCE 让顶层（parent_id 为 NULL）也受唯一约束。 */
export const resourceParentNameIndexSQL = `
CREATE UNIQUE INDEX IF NOT EXISTS resource_parent_name_unique ON resource (COALESCE(parent_id, ''), name);
`;
