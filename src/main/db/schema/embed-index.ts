import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 向量索引注册表：一个「模型身份」一行，对应一张独立的向量表。
 *
 * 本表存的是**已落盘的事实**，与配置里的 `embedding.models` 是两回事：
 * 配置是用户的意图，随时会被改（换地址、改模型、改名）；
 * 本表只在一次成功的向量化调用之后才写入，配置的增删改一律不触碰它。
 *
 * 之所以一个模型一张表：sqlite-vector 的 `vector_init` 是列级声明维度的，
 * 一个 BLOB 列只能承载一个维度，不同模型的向量混在一列里扫描会算出错误的距离。
 */
export const embedIndexTable = sqliteTable('embed_index', {
  /** 自增主键。同时用作向量表名的后缀，以及 embed_issue 的归属标识。 */
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 模型身份指纹：由归一化地址、模型标识与向量空间版本派生出的 SHA256。 */
  fingerprint: text('fingerprint').notNull(),
  /** 向量表名，形如 `embed_vec_<维度>_<id>`。 */
  tableName: text('table_name').notNull(),
  /** 模型标识，仅用于界面展示与排查。 */
  modelId: text('model_id').notNull(),
  /** 向量维度。喂给 `vector_init` 的唯一权威来源。 */
  dimension: integer('dimension').notNull(),
  /** 最近一次使用的配置键名，仅用于界面展示。 */
  lastLabel: text('last_label'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at').notNull(),
});

export type EmbedIndexRow = typeof embedIndexTable.$inferSelect;
export type InsertEmbedIndexRow = typeof embedIndexTable.$inferInsert;

export const embedIndexSQL = `
CREATE TABLE IF NOT EXISTS embed_index (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint  TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  dimension    INTEGER NOT NULL,
  last_label   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
`;

export const embedIndexFingerprintIndexSQL = `
CREATE UNIQUE INDEX IF NOT EXISTS embed_index_fingerprint_idx ON embed_index(fingerprint);
`;

export const embedIndexModelIndexSQL = `
CREATE INDEX IF NOT EXISTS embed_index_model_idx ON embed_index(model_id);
`;
