import type { BookEmbedding } from '@shared/types/books';
import { getRawDatabase, runInTransaction } from '..';
import { bookChunkRepo } from './book-chunk-repo';
import { embedIndexRepo } from './embed-index-repo';
import { embedTaskRepo } from './embed-task-repo';
import { embedVectorRepo } from './embed-vector-repo';

/** 三条固定查询的结果，供多次拼装复用。 */
interface EmbeddingSnapshot {
  /** 每本书的分片数 */
  totals: Map<string, number>;
  /** 进度行，key 是 bookId */
  tasks: Map<string, { done: number; lastError: string | null; embedIndexId: number }>;
  /** 索引注册表，key 是 embed_index.id */
  indexes: Map<number, string>;
}

/**
 * 「一本书的向量化信息」的读写。
 *
 * 向量本体在按模型建的动态表里、进度在 `embed_task` 里、模型身份在 `embed_index` 里，
 * 所以按书读一次要跨三张表，按书删一次要遍历所有向量表。这些操作收在这里：
 * 调用方各写一遍的话，漏一处就会留下孤儿向量——那些行再也找不到，只会白占空间。
 *
 * **写操作一律自己开事务。** 它们都是跨表的，调用方无从判断边界在哪。
 */
export class BookEmbeddingRepo {
  /**
   * 读一本书的向量化信息。
   *
   * **永远返回完整的对象**，没索引过时各字段为初始值——`total` 仍然来自分片表，
   * 所以「一片都没有」和「有分片但没向量」在界面上分得开。
   */
  load(bookId: string): BookEmbedding {
    return this.build(bookId, this.snapshot());
  }

  /** 一次读完给定书籍，避免按书逐个查询。**每个请求过的 id 都保证有值。** */
  loadAll(bookIds: string[]): Record<string, BookEmbedding> {
    const snapshot = this.snapshot();
    const loaded: Record<string, BookEmbedding> = {};
    for (const bookId of bookIds) {
      loaded[bookId] = this.build(bookId, snapshot);
    }
    return loaded;
  }

  /**
   * 清掉一本书的向量与进度行。
   *
   * @param keepEmbedIndexId 保留哪个模型的向量；传 null 表示全清。
   *   重新分片与删除书籍要全清；开始向量化前只清别的模型，当前模型下没做完的部分要接着做。
   */
  drop(bookId: string, keepEmbedIndexId: number | null): void {
    runInTransaction(() => {
      for (const index of embedIndexRepo.listAll()) {
        if (index.id === keepEmbedIndexId) continue;
        embedVectorRepo.deleteBySource(index.tableName, 'book', bookId);
      }
      // 进度行指向被清掉的模型时一并删掉：它的 done 已经没有对应的向量了
      const row = embedTaskRepo.findByBook(bookId);
      if (row && row.embedIndexId !== keepEmbedIndexId) {
        embedTaskRepo.deleteByBook(bookId);
      }
    });
  }

  /**
   * 按向量表对账进度行：有向量却没有进度行的书，补上。
   *
   * 进度行是派生的，向量表才是事实源。**按书判断**：迁移跑到一半崩掉、或者中途有书
   * 被处理过，表里就会有零散的行；若按「整张表为空才补」整体跳过，剩下的书会被永远漏掉。
   * 判据幂等，跑多少次都一样，所以启动时对账一次即可。
   */
  reconcile(): void {
    const indexes = embedIndexRepo.listAll();
    if (indexes.length === 0) return;

    const totals = new Map(
      bookChunkRepo.aggregateCountsByBook().map(row => [row.bookId, row.count])
    );
    const known = new Set(embedTaskRepo.listAll().map(row => row.bookId));

    runInTransaction(() => {
      for (const index of indexes) {
        for (const row of embedVectorRepo.aggregateBySource(index.tableName)) {
          if (known.has(row.sourceId)) continue;
          embedTaskRepo.setDone({
            bookId: row.sourceId,
            embedIndexId: index.id,
            total: totals.get(row.sourceId) ?? row.count,
            done: row.count,
          });
        }
      }
    });
  }

  /**
   * 三条固定查询。不按模型数量去扫动态向量表——进度行里的 `done` 已经是那些表的计数副本。
   */
  private snapshot(): EmbeddingSnapshot {
    return {
      totals: new Map(bookChunkRepo.aggregateCountsByBook().map(row => [row.bookId, row.count])),
      tasks: new Map(
        embedTaskRepo
          .listAll()
          .map(row => [
            row.bookId,
            { done: row.done, lastError: row.lastError, embedIndexId: row.embedIndexId },
          ])
      ),
      indexes: new Map(embedIndexRepo.listAll().map(row => [row.id, row.fingerprint])),
    };
  }

  /** 把快照拼成一本书的向量化信息。 */
  private build(bookId: string, snapshot: EmbeddingSnapshot): BookEmbedding {
    const task = snapshot.tasks.get(bookId);
    // 索引注册记录缺失时（正常流程下不该发生）当作没索引过：
    // 给不出一份「不知道是谁生成的」向量信息，那样界面只能靠猜
    const index = task ? snapshot.indexes.get(task.embedIndexId) : undefined;
    return {
      total: snapshot.totals.get(bookId) ?? 0,
      done: task?.done ?? 0,
      modelFingerprint: index ?? null,
      lastError: task?.lastError ?? null,
    };
  }
}

export const bookEmbeddingRepo = new BookEmbeddingRepo();
