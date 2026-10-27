import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { bookTable } from './book';

/**
 * 书籍的处理阶段。闭合集合，新增阶段时在这里扩。
 *
 * 三个阶段各自独立成行，因为它们的产物、失效条件与参数指纹都不同：
 * `ocr` 只有 PDF 有，`chunk` 在导入或识别后同步完成，`embed` 是异步的。
 */
export type BookStage = 'ocr' | 'chunk' | 'embed';

/**
 * 书籍阶段表：`book` 的延伸，记下每个阶段走到了哪一步。
 *
 * 没有状态列。完成、失败与未开始全部由 `total` / `done` / `identity` / `last_error`
 * 推导出来，少一个状态机就少一批「状态写反了却不报错」的隐患。
 *
 * `total` / `done` 是三态：空表示还不知道要处理多少（PDF 尚未识别），0 表示已判定无需
 * 处理（例如全书都有文本层），N / M 表示已知进度。
 */
export const bookStageTable = sqliteTable(
  'book_stage',
  {
    /** 所属书籍 */
    bookId: text('book_id')
      .notNull()
      .references(() => bookTable.id, { onDelete: 'cascade' }),
    /** 阶段名 */
    stage: text('stage').$type<BookStage>().notNull(),
    /** 该阶段的单元总数；空表示未知 */
    total: integer('total'),
    /** 已完成的单元数；与 total 同为空值语义 */
    done: integer('done'),
    /**
     * 产出这批数据时的参数指纹。
     *
     * 只有 `embed` 的指纹参与可用性判断（模型换了向量就不能用）；`ocr` 与 `chunk`
     * 只把它当排查线索——换识别服务不该把已经付过钱的页判成失效。
     */
    identity: text('identity'),
    /** 当前阶段尚未解决的问题；成功一次后清空 */
    lastError: text('last_error'),
    /** 最近一次推进时间 */
    updatedAt: integer('updated_at').notNull(),
  },
  table => [primaryKey({ columns: [table.bookId, table.stage] })]
);

export type BookStageRow = typeof bookStageTable.$inferSelect;
export type InsertBookStageRow = typeof bookStageTable.$inferInsert;

export const bookStageSQL = `
CREATE TABLE IF NOT EXISTS book_stage (
  book_id    TEXT    NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  stage      TEXT    NOT NULL,
  total      INTEGER,
  done       INTEGER,
  identity   TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, stage)
);
`;
