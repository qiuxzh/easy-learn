import { eq, sql } from 'drizzle-orm';
import { getDatabase } from '..';
import { embedTaskTable } from '../schema';
import type { EmbedTaskRow } from '../schema';

/** 写入进度时要一并维护的字段。 */
export interface EmbedTaskScope {
  /** 所属书籍 id */
  bookId: string;
  /** 这份向量数据属于哪个索引，对应 embed_index.id */
  embedIndexId: number;
  /** 分片总数，随行一起写，避免总览再去查 book_chunk */
  total: number;
}

/**
 * 向量化进度的数据访问。
 *
 * **一本书一行**，所以这里的操作都按 `book_id` 定位，没有复合键。
 * 这张表只记「做到哪了」，没有状态列——状态由 `done` / `total` / `last_error`
 * 以及 `embed_index_id` 指向哪个模型推出来。
 *
 * **加完成数必须与写向量在同一个事务里。** 这是全项目唯一一处「两处记同一件事」，
 * 靠原子性保证 `done` 不滞后于向量行。
 */
export class EmbedTaskRepo {
  /** 全部进度行。书库页用它一次算完每本书的状态。 */
  listAll(): EmbedTaskRow[] {
    return getDatabase().select().from(embedTaskTable).all();
  }

  /** 查一本书的进度行。没做过时返回 undefined。 */
  findByBook(bookId: string): EmbedTaskRow | undefined {
    return getDatabase()
      .select()
      .from(embedTaskTable)
      .where(eq(embedTaskTable.bookId, bookId))
      .get();
  }

  /**
   * 累加完成数。批次成功后与写向量同事务调用，行不存在时创建。
   *
   * `total` 与 `embed_index_id` 每次一并覆盖：这一行描述的是**刚写进去的那批数据**，
   * 它属于哪个模型、分母是多少，都以这次写入为准。
   */
  addDone(input: EmbedTaskScope & { delta: number }): void {
    const now = Date.now();
    getDatabase()
      .insert(embedTaskTable)
      .values({
        bookId: input.bookId,
        embedIndexId: input.embedIndexId,
        total: input.total,
        done: input.delta,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: embedTaskTable.bookId,
        set: {
          embedIndexId: input.embedIndexId,
          done: sql`${embedTaskTable.done} + ${input.delta}`,
          total: input.total,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 直接设置完成数。用于任务开始时对账：以向量表算出的真实数量为准，
   * 把可能过期的进度行拉回来。也是「按向量表重建进度」的入口。
   *
   * 不碰 `last_error`：对账只修计数，失败原因由调用方显式清。
   */
  setDone(input: EmbedTaskScope & { done: number }): void {
    const now = Date.now();
    getDatabase()
      .insert(embedTaskTable)
      .values({
        bookId: input.bookId,
        embedIndexId: input.embedIndexId,
        total: input.total,
        done: input.done,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: embedTaskTable.bookId,
        set: {
          embedIndexId: input.embedIndexId,
          done: input.done,
          total: input.total,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 记下失败原因。行不存在时创建——首次运行第一批就失败时就是这种情况，
   * 此时 `done` 为 0，但「这本书试过、并且失败了」需要被记住。
   */
  setError(input: EmbedTaskScope & { error: string }): void {
    const now = Date.now();
    getDatabase()
      .insert(embedTaskTable)
      .values({
        bookId: input.bookId,
        embedIndexId: input.embedIndexId,
        total: input.total,
        done: 0,
        lastError: input.error,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: embedTaskTable.bookId,
        set: {
          embedIndexId: input.embedIndexId,
          lastError: input.error,
          total: input.total,
          updatedAt: now,
        },
      })
      .run();
  }

  /**
   * 清掉失败原因。任务开始时调用。
   * 不清的话，一本已经做完的书会因为残留的原因显示成「索引失败」。
   */
  clearError(bookId: string): void {
    getDatabase()
      .update(embedTaskTable)
      .set({ lastError: null, updatedAt: Date.now() })
      .where(eq(embedTaskTable.bookId, bookId))
      .run();
  }

  /** 按书删除进度行。重新分片、重新向量化、删除书籍都要用它。
   * 删行而不是把 `done` 置 0：分片换了之后「这本书做过」整句话都不成立了。
   */
  deleteByBook(bookId: string): void {
    getDatabase().delete(embedTaskTable).where(eq(embedTaskTable.bookId, bookId)).run();
  }
}

export const embedTaskRepo = new EmbedTaskRepo();
