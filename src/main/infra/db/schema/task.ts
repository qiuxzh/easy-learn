import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TaskStatus } from '@shared/types/task';

/**
 * 后台任务队列。
 *
 * 行只保存在途任务与待处理的失败任务：完成与取消会删除行，历史不留在表里。
 * 进度是展示快照，断点的事实来源是各任务自己的域表。
 */
export const taskTable = sqliteTable('task', {
  id: text().primaryKey(),
  /** 处理器注册表的 key。 */
  taskType: text('task_type').notNull(),
  status: text().$type<TaskStatus>().notNull(),
  /** JSON：TaskProgress。 */
  progress: text(),
  /** JSON：处理器专属入参。 */
  payload: text().notNull(),
  /** JSON：TaskError；仅 failed 时有值。 */
  error: text(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  startedAt: integer('started_at'),
  failedAt: integer('failed_at'),
});

export type TaskRow = typeof taskTable.$inferSelect;
export type InsertTaskRow = typeof taskTable.$inferInsert;

export const taskSQL = `
CREATE TABLE IF NOT EXISTS task (
  id         TEXT    PRIMARY KEY,
  task_type  TEXT    NOT NULL,
  status     TEXT    NOT NULL,
  progress   TEXT,
  payload    TEXT    NOT NULL,
  error      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  failed_at  INTEGER
);
`;

/** 领取队首与启动恢复都按 task_type + status 过滤。 */
export const taskTypeStatusCreatedIndexSQL = `
CREATE INDEX IF NOT EXISTS task_type_status_created_index
  ON task (task_type, status, created_at);
`;
