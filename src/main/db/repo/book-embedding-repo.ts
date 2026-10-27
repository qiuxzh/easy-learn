import type { BookEmbedding } from '@shared/types/books';
import { runInTransaction } from '..';
import { bookStageRepo } from './book-stage-repo';
import { embedIndexRepo } from './embed-index-repo';
import { embedVectorRepo } from './embed-vector-repo';
import type { BookStageRow } from '../schema';

/**
 * 「一本书的向量化信息」的读写。
 *
 * 数据源是 `book_stage` 的 `embed` 行（计数与模型指纹）与向量表（本体）。
 * 向量按模型分散在动态表里，所以按书删一次要遍历所有向量表——这些操作收在这里，
 * 调用方各写一遍的话，漏一处就会留下孤儿向量。
 *
 * 写操作一律自己开事务。它们都是跨表的，调用方无从判断边界在哪。
 */
export class BookEmbeddingRepo {
  /**
   * 读一本书的向量化信息。
   *
   * 永远返回完整的对象，没索引过时各字段为初始值。`total` 仍然来自分片数，
   * 所以「一片都没有」和「有分片但没向量」在界面上分得开。
   */
  load(bookId: string): BookEmbedding {
    return this.loadAll([bookId])[bookId];
  }

  /** 一次读完给定书籍，避免按书逐个查询；每个请求过的 id 都保证有值。 */
  loadAll(bookIds: string[]): Record<string, BookEmbedding> {
    const rows = bookStageRepo.listByBooks(bookIds);
    const byBook = new Map<string, BookStageRow[]>();
    for (const row of rows) {
      const list = byBook.get(row.bookId);
      if (list) list.push(row);
      else byBook.set(row.bookId, [row]);
    }

    const loaded: Record<string, BookEmbedding> = {};
    for (const bookId of bookIds) {
      loaded[bookId] = this.build(byBook.get(bookId) ?? []);
    }
    return loaded;
  }

  /**
   * 清掉一本书的向量与对应阶段计数。
   *
   * @param keepEmbedIndexId 保留哪个模型的向量；传 null 表示全清。
   *   重新分片与删除书籍要全清；开始向量化前只清别的模型，当前模型下没做完的部分要接着做。
   */
  drop(bookId: string, keepEmbedIndexId: number | null): void {
    // 保留的模型换了，阶段行里的指纹就不能再算数
    const keepFingerprint =
      keepEmbedIndexId === null
        ? null
        : (embedIndexRepo.findById(keepEmbedIndexId)?.fingerprint ?? null);

    runInTransaction(() => {
      for (const index of embedIndexRepo.listAll()) {
        if (index.id === keepEmbedIndexId) continue;
        embedVectorRepo.deleteBySource(index.tableName, 'book', bookId);
      }
      const row = bookStageRepo.find(bookId, 'embed');
      if (row && row.identity !== keepFingerprint) {
        bookStageRepo.resetEmbed(bookId);
      }
    });
  }

  /** 把一本书的阶段行拼成界面上要的向量化信息。 */
  private build(rows: BookStageRow[]): BookEmbedding {
    const chunk = rows.find(row => row.stage === 'chunk');
    const embed = rows.find(row => row.stage === 'embed');
    return {
      // 分片行是分母的事实来源；embed 行缺席时退到它，避免显示成「没有分片」
      total: embed?.total ?? chunk?.total ?? 0,
      done: embed?.done ?? 0,
      modelFingerprint: embed?.identity ?? null,
      lastError: embed?.lastError ?? null,
    };
  }
}

export const bookEmbeddingRepo = new BookEmbeddingRepo();
