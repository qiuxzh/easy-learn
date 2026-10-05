import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { v4 as uuidv4 } from 'uuid';

/**
 * 会话日志表。一条 entry 一行，type 专属字段统一存入 payload JSON。
 * 消息与不进上下文的状态记录（模型变更、压缩标记）共用一张表，
 * 从而使用同一套 seq 保序，读取时无需跨表排序。
 */
export const agentEntryTable = sqliteTable('agent_entry', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  /** 所属会话。会话删除时由外键级联删除。 */
  sessionId: text('session_id').notNull(),
  /** 会话内单调递增序号，决定 entry 顺序。 */
  seq: integer().notNull(),
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
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  payload TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_session(id) ON DELETE CASCADE
);
`;

export const agentEntrySessionSeqIndexSQL = `
CREATE UNIQUE INDEX IF NOT EXISTS agent_entry_session_seq_idx ON agent_entry(session_id, seq);
`;
