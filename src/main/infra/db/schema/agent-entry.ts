import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { v4 as uuidv4 } from 'uuid';

/**
 * 消息对象表。一条 entry 一行，不同 type 的消息的专属字段统一存入 payload JSON。
 *
 */
export const agentEntryTable = sqliteTable('agent_entry', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  /** 上一个 entry。NULL 表示这是一条分支的根。 */
  parentEntryId: text('parent_entry_id'),
  /** entry 种类：message / model_change / compaction。 */
  type: text().notNull(),
  /** 创建时间，Unix 毫秒。 */
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  /** 该种类专属字段的 JSON，具体结构由 agent 层的 SessionEntry 决定。 */
  payload: text({ mode: 'json' }).$type<unknown>().notNull(),
});

export type AgentEntryRow = typeof agentEntryTable.$inferSelect;
export type InsertAgentEntryRow = typeof agentEntryTable.$inferInsert;

export const agentEntrySQL = `
CREATE TABLE IF NOT EXISTS agent_entry (
  id TEXT PRIMARY KEY,
  parent_entry_id TEXT,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  payload TEXT NOT NULL
);
`;

export const agentEntryParentIndexSQL = `
CREATE INDEX IF NOT EXISTS agent_entry_parent_idx ON agent_entry(parent_entry_id);
`;
