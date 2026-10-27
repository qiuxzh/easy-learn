import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, runInTransaction } from '..';
import { bookStageTable } from '../schema';
import type { BookStage, BookStageRow } from '../schema';
import type { BookStages } from '@shared/types/books';

/** 写向量阶段进度时随进度一起落库的字段，描述刚写入的那批向量。 */
export interface EmbedStageWrite {
  /** 所属书籍 id */
  bookId: string;
  /** 分片总数，即这次进度的分母 */
  total: number;
  /** 产出这些向量的模型指纹 */
  identity: string;
}

/**
 * 书籍阶段的数据访问。
 *
 * 一个阶段一行，主键是 `(book_id, stage)`。
 *
 * 没有状态列：完成与否看 `done >= total`（`total` 为 `NULL` 表示分母未知），失败与否看 `last_error`。
 * `identity` 只在向量阶段参与「现有数据算不算数」的判断；OCR 阶段的它只用于展示来源。
 *
 * 事务边界：`writeChunks` 自带事务，因为它同时改两行；其余写方法是单行写，
 * 需要与事实行（分片、向量、页块）同属一个提交时，由调用方开事务。
 *
 * OCR 的写方法用 `UPDATE`：行不存在时不产生任何效果，调用方必须先通过 `createRows` 建行。
 */
export class BookStageRepo {
  /**
   * 批量读取若干本书的全部阶段行，避免按书逐个查询。
   * @param bookIds 目标书籍；为空时不查库，直接返回空数组。
   */
  listByBooks(bookIds: string[]): BookStageRow[] {
    if (bookIds.length === 0) return [];
    return getDatabase()
      .select()
      .from(bookStageTable)
      .where(inArray(bookStageTable.bookId, bookIds))
      .all();
  }

  /**
   * 取一本书的一个阶段。
   * @returns 没有对应行时为 `undefined`——表示该阶段当前不适用，而不是「还没开始」。
   */
  find(bookId: string, stage: BookStage): BookStageRow | undefined {
    return getDatabase()
      .select()
      .from(bookStageTable)
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, stage)))
      .get();
  }

  /**
   * 批量读取阶段进度，按书组织成渲染层直接使用的形状。
   *
   * 传入的每本书都会得到一个对象：没有阶段行时是空对象。键不存在表示该阶段
   * 当前不适用，由调用方按书类型解释，这里不替它推断。
   * @param bookIds 结果里要出现的书；重复 id 只产生一个键。
   */
  loadMany(bookIds: string[]): Record<string, BookStages> {
    const stages: Record<string, BookStages> = {};
    for (const bookId of bookIds) {
      stages[bookId] = {};
    }
    for (const row of this.listByBooks(bookIds)) {
      const entry = stages[row.bookId] ?? {};
      entry[row.stage] = {
        total: row.total,
        done: row.done,
        identity: row.identity,
        lastError: row.lastError,
      };
      stages[row.bookId] = entry;
    }
    return stages;
  }

  /**
   * 取一本书的阶段进度。
   * @returns 空对象表示这本书还没有任何阶段行；不会返回 `undefined`。
   */
  load(bookId: string): BookStages {
    return this.loadMany([bookId])[bookId];
  }

  /**
   * 为这本书建出若干阶段的空行（`total` / `done` 为 `NULL`，表示分母未知）。
   *
   * 行存在的语义是「该阶段适用于这本书」，所以导入时为适用阶段建行，
   * 之后「行不存在」只表示不适用。已存在的行不会被重置。
   * @param stages 要建立的阶段；空数组不产生任何语句。
   */
  createRows(bookId: string, stages: BookStage[]): void {
    if (stages.length === 0) return;
    const now = Date.now();
    getDatabase()
      .insert(bookStageTable)
      .values(
        stages.map(stage => ({
          bookId,
          stage,
          total: null,
          done: null,
          identity: null,
          lastError: null,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing()
      .run();
  }

  /**
   * 分片写入后的阶段状态：`chunk` 记为完成，`embed` 归零。
   *
   * 两行必须在同一个提交里：分片换了，旧向量就不再对应同一段正文，
   * 只更新 `chunk` 会让界面显示「已向量化」而检索结果对不上。
   * 分片是原子产成的，所以 `chunk` 的 `total` 与 `done` 相等。
   * @param count 新写入的分片数，同时作为两个阶段的分母。
   */
  writeChunks(bookId: string, count: number): void {
    const now = Date.now();
    runInTransaction(() => {
      this.upsert({
        bookId,
        stage: 'chunk',
        total: count,
        done: count,
        identity: null,
        lastError: null,
        updatedAt: now,
      });
      this.upsert({
        bookId,
        stage: 'embed',
        total: count,
        done: 0,
        identity: null,
        lastError: null,
        updatedAt: now,
      });
    });
  }

  /**
   * 累加向量完成数，同时覆盖 `total` 与 `identity`：这一行描述的是刚写入的那批向量属于哪个模型。
   *
   * 必须与写向量同事务调用，否则崩溃后计数会领先于向量行。
   * 不清 `last_error`：清理失败原因由任务启动时的 `clearError` 负责。
   * `delta` 是本次写入的向量条数；行不存在时从 0 起算。
   */
  addEmbedDone(input: EmbedStageWrite & { delta: number }): void {
    const now = Date.now();
    getDatabase()
      .insert(bookStageTable)
      .values({
        bookId: input.bookId,
        stage: 'embed',
        total: input.total,
        done: input.delta,
        identity: input.identity,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [bookStageTable.bookId, bookStageTable.stage],
        set: {
          // 行可能是从「未知」建出来的，累加前先把空值当 0
          done: sql`COALESCE(${bookStageTable.done}, 0) + ${input.delta}`,
          total: input.total,
          identity: input.identity,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 按向量表校正向量完成数，任务开始时调用一次。
   *
   * 阶段行可能因崩溃或模型切换与向量表对不上；运行期以向量表为准，这一行只服务总览。
   * 不碰 `last_error`：这里只修计数，失败原因由调用方显式清。
   * `done` 是向量表里实际存在的条数。
   */
  setEmbedDone(input: EmbedStageWrite & { done: number }): void {
    const now = Date.now();
    getDatabase()
      .insert(bookStageTable)
      .values({
        bookId: input.bookId,
        stage: 'embed',
        total: input.total,
        done: input.done,
        identity: input.identity,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [bookStageTable.bookId, bookStageTable.stage],
        set: {
          done: input.done,
          total: input.total,
          identity: input.identity,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 记下向量化的失败原因。
   *
   * 不改 `identity` 与 `done`：失败可能发生在第一批，此时一条向量都没有，
   * 把它们写成「属于这个模型、已完成若干」会让界面显示成「已向量化」。
   * 行不存在时建一行，`done` 记 0。
   */
  setEmbedError(input: { bookId: string; total: number; error: string }): void {
    const now = Date.now();
    getDatabase()
      .insert(bookStageTable)
      .values({
        bookId: input.bookId,
        stage: 'embed',
        total: input.total,
        done: 0,
        identity: null,
        lastError: input.error,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [bookStageTable.bookId, bookStageTable.stage],
        set: {
          total: input.total,
          lastError: input.error,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 设置识别阶段的完成页数。
   *
   * 用「设置」而不是「累加」：识别结果按页落库，页数就是事实，重跑一块不会把同一页重复计数。
   * @param done 已落库的页数，由 `book_page` 的实际行数得出。
   */
  setOcrDone(bookId: string, done: number): void {
    getDatabase()
      .update(bookStageTable)
      .set({ done, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, 'ocr')))
      .run();
  }

  /**
   * 识别全部完成：分母对齐总页数、记下识别模型、清掉旧错误。
   *
   * OCR 的 `identity` 只用于展示来源，不参与「结果算不算数」的判断。
   * @param total 全书页数。
   * @param identity 识别模型的标识，随结果一起展示。
   */
  setOcrComplete(bookId: string, total: number, identity: string): void {
    getDatabase()
      .update(bookStageTable)
      .set({ total, done: total, identity, lastError: null, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, 'ocr')))
      .run();
  }

  /**
   * 识别结果被清空：计数与身份归零，分母回到未知。
   * 下一次识别完成时由 `setOcrComplete` 重新给出 `total`。
   */
  resetOcr(bookId: string): void {
    getDatabase()
      .update(bookStageTable)
      .set({ total: null, done: 0, identity: null, lastError: null, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, 'ocr')))
      .run();
  }

  /**
   * 清掉某个阶段的失败原因。
   *
   * 写进度不会顺手清它：留着旧错误会让界面继续显示上一次失败。
   */
  clearError(bookId: string, stage: BookStage): void {
    getDatabase()
      .update(bookStageTable)
      .set({ lastError: null, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, stage)))
      .run();
  }

  /**
   * 设置某个阶段的分母，用于「已经知道要处理多少、但还没开始」的书。
   *
   * `done` 一并补成 0：分母已知时还留着空值，读起来像「不知道做了多少」。
   * @param total 该阶段要处理的单元数。
   */
  setStageTotal(bookId: string, stage: BookStage, total: number): void {
    getDatabase()
      .update(bookStageTable)
      .set({ total, done: sql`COALESCE(${bookStageTable.done}, 0)`, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, stage)))
      .run();
  }

  /** 记下某个阶段的问题，`done` 与 `identity` 保持不动。 */
  setStageError(bookId: string, stage: BookStage, error: string): void {
    getDatabase()
      .update(bookStageTable)
      .set({ lastError: error, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, stage)))
      .run();
  }

  /**
   * 把向量阶段归零：向量已经被删掉了，`done` 与 `identity` 都不能留。
   * `total` 保持不动——分片还在，分母没变。
   */
  resetEmbed(bookId: string): void {
    getDatabase()
      .update(bookStageTable)
      .set({ done: 0, identity: null, lastError: null, updatedAt: Date.now() })
      .where(and(eq(bookStageTable.bookId, bookId), eq(bookStageTable.stage, 'embed')))
      .run();
  }

  /** 插入或整行覆盖，只给 `writeChunks` 用：它要在同一个事务里写好两行。 */
  private upsert(row: {
    bookId: string;
    stage: BookStage;
    total: number | null;
    done: number | null;
    identity: string | null;
    lastError: string | null;
    updatedAt: number;
  }): void {
    getDatabase()
      .insert(bookStageTable)
      .values(row)
      .onConflictDoUpdate({
        target: [bookStageTable.bookId, bookStageTable.stage],
        set: {
          total: row.total,
          done: row.done,
          identity: row.identity,
          lastError: row.lastError,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
}

export const bookStageRepo = new BookStageRepo();
