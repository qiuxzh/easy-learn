import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Agent 会话表。会话是内核的持久单元，保存标识、标题与时间。
 * id 由调用方（前端）生成，表不自动分配。
 */
export const agentSessionTable = sqliteTable('agent_session', {
  id: text().primaryKey(),
  /** 会话标题，仅用于列表展示。 */
  title: text().notNull().default(''),
  /** 创建时间，Unix 毫秒。 */
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  /** 最近活跃时间，Unix 毫秒。追加 entry 时更新，列表按此倒序。 */
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type AgentSessionRow = typeof agentSessionTable.$inferSelect;
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert;

export const agentSessionSQL = `
CREATE TABLE IF NOT EXISTS agent_session (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
`;

export const agentSessionUpdatedAtIndexSQL = `
CREATE INDEX IF NOT EXISTS agent_session_updated_at_idx ON agent_session(updated_at DESC);
`;
