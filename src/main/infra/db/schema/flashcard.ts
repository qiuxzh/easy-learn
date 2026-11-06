import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { v4 as uuidv4 } from 'uuid';

/** 闪卡牌组表。卡片通过 group_id 关联到牌组，并在数据库层级联删除。 */
export const cardGroupTable = sqliteTable('card_groups', {
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  name: text().notNull(),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type CardGroupRow = typeof cardGroupTable.$inferSelect;
export type InsertCardGroupRow = typeof cardGroupTable.$inferInsert;

export const cardGroupSQL = `
CREATE TABLE IF NOT EXISTS card_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** 闪卡表定义。内容和标签使用 JSON 文本保存，复习进度使用 FSRS 对应字段保存。 */
export const cardTable = sqliteTable('cards', {
  /** 卡片唯一标识。 */
  id: text()
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  /** 所属牌组 ID，牌组删除时级联删除卡片。 */
  groupId: text('group_id').notNull(),
  /** 卡片类型，当前仅支持 basic。 */
  type: text().notNull(),
  /** JSON 文本，保存正面和反面 Markdown 内容。 */
  fields: text().notNull(),
  /** JSON 文本，保存标签字符串数组。 */
  tags: text().notNull(),
  /** 卡片创建时间，使用 Unix 毫秒时间戳。 */
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  /** 卡片最后修改时间，使用 Unix 毫秒时间戳。 */
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  /** 下一次可复习时间，使用 Unix 毫秒时间戳。 */
  due: integer().notNull(),
  /** FSRS 稳定性参数，表示记忆保持能力的估计值。 */
  stability: real().notNull(),
  /** FSRS 难度参数，表示卡片被记住的相对难度。 */
  difficulty: real().notNull(),
  /** 上一次复习到当前时间经过的天数。 */
  elapsedDays: integer('elapsed_days').notNull(),
  /** 本次复习安排的间隔天数。 */
  scheduledDays: integer('scheduled_days').notNull(),
  /** 当前学习步骤编号，用于记录学习阶段的进展。 */
  learningSteps: integer('learning_steps').notNull(),
  /** 卡片被复习的总次数。 */
  reps: integer().notNull(),
  /** 卡片遗忘后重新学习的次数。 */
  lapses: integer().notNull(),
  /** FSRS 卡片状态，数值与 ts-fsrs 的 State 枚举对应。 */
  state: integer().notNull(),
  /** 最近一次复习时间，未复习的新卡片为空。 */
  lastReview: integer('last_review'),
});

export type CardRow = typeof cardTable.$inferSelect;
export type InsertCardRow = typeof cardTable.$inferInsert;

export const cardSQL = `
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL,
  fields TEXT NOT NULL,
  tags TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  state INTEGER NOT NULL,
  last_review INTEGER,
  FOREIGN KEY (group_id) REFERENCES card_groups(id) ON DELETE CASCADE
);
`;

export const cardGroupIdIndexSQL = `
CREATE INDEX IF NOT EXISTS cards_group_id_idx ON cards(group_id);
`;

export const cardDueIndexSQL = `
CREATE INDEX IF NOT EXISTS cards_group_due_idx ON cards(group_id, state, due);
`;
