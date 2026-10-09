import type { RetrievalDocument, RetrievalHit } from '../types';
import type { Bm25Index } from './types';
import { buildBm25Index, searchBm25Index } from './core';
import { tokenizeQuery } from './tokenizer';

/** 构造检索器所需的依赖。 */
export interface Bm25RetrieverOptions<T extends RetrievalDocument> {
  /**
   * 按 key 取文档。
   *
   * 必须按期望的兜底顺序返回（书籍场景是阅读顺序）：索引内部的同分排序用的就是这份顺序。
   * 同一 key 的并发首次检索只会调用一次。
   */
  load: (key: string) => T[] | Promise<T[]>;
}

/**
 * 带索引缓存的 BM25 检索器。
 *
 * 解耦功能：**它不认识书籍，也不认识数据库**：文档从哪来由 `load` 决定，缓存键的语义由调用方决定。
 *
 * 缓存为什么留在这一层：缓存的对象就是索引本身，不是外挂在检索之外的一层。
 * 反过来，「哪份数据变了」只有调用方知道，所以失效不自动发生——由调用方在写路径上调 `invalidate`。
 *
 * 索引没有 TTL，直到 `invalidate` 或进程回收才释放。
 */
export class Bm25Retriever<T extends RetrievalDocument> {
  private readonly options: Bm25RetrieverOptions<T>;

  /** 已建好的索引，key 的语义由调用方决定 */
  private readonly indexes = new Map<string, Bm25Index<T>>();

  /** 正在构建的索引，用于把同一 key 的并发首次检索合并成一次构建
   * 防止并发search导致多次检索 */
  private readonly building = new Map<string, Promise<Bm25Index<T>>>();

  constructor(options: Bm25RetrieverOptions<T>) {
    this.options = options;
  }

  /** 执行检索。查询分词后为空时直接返回空结果，不会触发建索引。 */
  async search(key: string, query: string, topK: number): Promise<RetrievalHit<T>[]> {
    const queryTerms = tokenizeQuery(query);
    if (queryTerms.length === 0) return [];

    const index = await this.getOrBuildIndex(key);
    return searchBm25Index(index, queryTerms, topK);
  }

  /** 丢弃某个 key 的索引，下次检索重新构建。数据变更后由调用方调用。 */
  invalidate(key: string): void {
    this.indexes.delete(key);
    this.building.delete(key);
  }

  /** 读缓存，未命中则加载文档并建索引；同一 key 的并发首次检索合并为一次构建任务。 */
  private async getOrBuildIndex(key: string): Promise<Bm25Index<T>> {
    const cached = this.indexes.get(key);
    if (cached) return cached;

    const building = this.building.get(key);
    if (building) return building;

    // 加载数据并建立索引
    const task = Promise.resolve()
      .then(() => this.options.load(key))
      .then(documents => {
        const index = buildBm25Index(documents);
        this.indexes.set(key, index);
        return index;
      });

    this.building.set(key, task);
    try {
      return await task;
    } finally {
      this.building.delete(key);
    }
  }
}
