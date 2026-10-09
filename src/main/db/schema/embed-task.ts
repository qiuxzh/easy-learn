import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 一本书的向量化进度。
 *
 * **主键是 `book_id`：一本书只有一行。**
 *
 * 这是「一本书在任一时刻最多只有一个模型下有向量」这条不变式的落库形态。
 * 它换来的是状态的互斥性：一份数据要么属于当前模型、要么属于旧模型，
 * 不可能同时是「已索引」和「未索引」，所以状态可以是一个普通枚举，
 * 不需要再把「别的模型有什么」掺进判定里。
 *
 * 清掉别的模型的时机在编排层：每次开始向量化之前，先把不是当前模型留下的产物删掉。
 *
 * **没有状态列。** 状态全部是推出来的——`done >= total` 是已索引，`last_error`
 * 非空是失败，`embed_index_id` 指向别的模型是「需重建」，其余是未索引；
 * 「索引中」与「已暂停」只活在内存里。少一个状态机，就少一批「状态写反了却不报错」的隐患。
 */
export const embedTaskTable = sqliteTable('embed_task', {
  /** 所属书籍 id */
  bookId: text('book_id').primaryKey(),
  /** 这份向量数据属于哪个索引，对应 embed_index.id */
  embedIndexId: integer('embed_index_id').notNull(),
  /** 分片总数。它是 book_chunk 计数的副本，重新分片时必须删掉这些行，否则会过期 */
  total: integer('total').notNull(),
  /** 已经有向量的分片数。与写向量同事务累加，所以不会滞后于向量行 */
  done: integer('done').notNull().default(0),
  /** 最近一次停下的原因。任务成功收尾时清空，所以它非空就等于「上次是失败停的」 */
  lastError: text('last_error'),
  /** 最近一次写入时间 */
  updatedAt: integer('updated_at').notNull(),
});

export type EmbedTaskRow = typeof embedTaskTable.$inferSelect;
export type InsertEmbedTaskRow = typeof embedTaskTable.$inferInsert;

export const embedTaskSQL = `
CREATE TABLE IF NOT EXISTS embed_task (
  book_id        TEXT    PRIMARY KEY,
  embed_index_id INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  done           INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  updated_at     INTEGER NOT NULL
);
`;

/** 删除某个向量索引时按它清理进度行。 */
export const embedTaskIndexSQL = `
CREATE INDEX IF NOT EXISTS embed_task_index_idx ON embed_task(embed_index_id);
`;
