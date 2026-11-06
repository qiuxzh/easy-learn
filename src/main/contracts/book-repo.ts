export type {
  BookChunkCount,
  BookChunkDraft,
  BookChunkEntity,
  BookCreate,
  BookPageContent,
  BookPageWrite,
  BookEntity,
  BookStage,
  BookStageProgress,
  EmbedIndexInsert,
  EmbedIndex,
  EmbedSourceType,
  EmbedStageWrite,
  InsertVectorRow,
  PendingChunk,
  VectorCountBySource,
  VectorSearchHit,
  VectorTableRef,
} from './book';

import type { BookEmbedding, BookStages } from '@shared/types/books';
import type {
  BookChunkCount,
  BookChunkDraft,
  BookChunkEntity,
  BookCreate,
  BookPageContent,
  BookPageWrite,
  BookEntity,
  BookStage,
  BookStageProgress,
  EmbedIndexInsert,
  EmbedIndex,
  EmbedSourceType,
  EmbedStageWrite,
  InsertVectorRow,
  PendingChunk,
  VectorCountBySource,
  VectorSearchHit,
  VectorTableRef,
} from './book';

/** 书籍表的持久化接口。 */
export interface BookRepo {
  /** 新建书，返回落库后的记录。 */
  create(data: BookCreate): BookEntity;
  /** 按 id 查询。 */
  findById(id: string): BookEntity | undefined;
  /** 全部书籍。 */
  findAll(): BookEntity[];
  /** 读取书籍源文件的落盘文件名；书不存在时返回 null。 */
  findStoreName(id: string): string | null;

  /** 回写封面附件 id；传 null 表示移除封面。 */
  updateCoverAttachment(id: string, coverAttachment: string | null): void;
  /** 更新书名与作者。 */
  updateMeta(id: string, data: Pick<BookEntity, 'booksName' | 'author'>): void;
  /** 删除书籍，派生行由外键级联删除。 */
  delete(id: string): void;
}

/** 书籍阶段进度的持久化接口。 */
export interface BookStageRepo {
  /** 一次读取多本书的全部阶段行。 */
  listByBooks(bookIds: string[]): BookStageProgress[];
  /** 读一本书某个阶段的行。 */
  find(bookId: string, stage: BookStage): BookStageProgress | undefined;
  /** 批量读取阶段进度，按书索引。 */
  loadMany(bookIds: string[]): Record<string, BookStages>;
  /** 读一本书的阶段进度。 */
  load(bookId: string): BookStages;
  /** 创建缺失的阶段行。 */
  createRows(bookId: string, stages: BookStage[]): void;
  /** 分片写入后的阶段状态：chunk 完成，embed 归零。 */
  writeChunks(bookId: string, count: number): void;
  /** 累加向量化完成数。 */
  addEmbedDone(input: EmbedStageWrite & { delta: number }): void;
  /** 直接设置向量化完成数。 */
  setEmbedDone(input: EmbedStageWrite & { done: number }): void;
  /** 记录向量化失败原因。 */
  setEmbedError(input: { bookId: string; total: number; error: string }): void;
  /** 记录 OCR 完成数。 */
  setOcrDone(bookId: string, done: number): void;
  /** 记录 OCR 完成总数与指纹。 */
  setOcrComplete(bookId: string, total: number, identity: string): void;
  /** 重置 OCR 阶段。 */
  resetOcr(bookId: string): void;
  /** 清除某个阶段的失败原因。 */
  clearError(bookId: string, stage: BookStage): void;
  /** 设置阶段总数。 */
  setStageTotal(bookId: string, stage: BookStage, total: number): void;
  /** 记录阶段失败原因。 */
  setStageError(bookId: string, stage: BookStage, error: string): void;
  /** 重置向量化阶段。 */
  resetEmbed(bookId: string): void;
}

/** 正文分片的持久化接口。 */
export interface BookChunkRepo {
  /** 按切分产物写入一本书的全部分片，返回写入条数。 */
  createForBook(bookId: string, drafts: readonly BookChunkDraft[]): number;
  /** 批量写分片行。 */
  createMany(chunks: readonly BookChunkEntity[]): void;
  /** 按书读全部分片，按阅读顺序。 */
  findByBookId(bookId: string): BookChunkEntity[];
  /** 按 id 批量查。 */
  findByIds(ids: string[]): BookChunkEntity[];
  /** 取一本书开头若干分片。 */
  listFirstByBookId(bookId: string, limit: number): BookChunkEntity[];
  /** 删除一本书的全部分片。 */
  deleteByBookId(bookId: string): void;
  /** 统计一本书的分片数。 */
  countByBookId(bookId: string): number;
  /** 按书聚合分片数。 */
  aggregateCountsByBook(): BookChunkCount[];
}

/** OCR 逐页结果的持久化接口。 */
export interface BookPageRepo {
  /** 读一本书全部页的 OCR 结果。 */
  listBlocks(bookId: string): BookPageContent[];
  /** 读指定页的 OCR 结果。 */
  listPages(bookId: string, pages: number[]): BookPageContent[];
  /** 已有 OCR 结果的页码集合。 */
  listPageNumbers(bookId: string): Set<number>;
  /** 已有 OCR 结果的页数。 */
  countPages(bookId: string): number;
  /** 批量写入页结果；同一个块的行在事务里调用。 */
  insertMany(rows: readonly BookPageWrite[]): void;
  /** 删除指定页的结果。 */
  deletePages(bookId: string, pages: number[]): void;
  /** 删除一本书的全部页结果。 */
  deleteByBook(bookId: string): void;
}

/** 一本书的向量化信息读写接口。 */
export interface BookEmbeddingRepo {
  /** 读一本书的向量化信息。 */
  load(bookId: string): BookEmbedding;
  /** 批量读，按书索引。 */
  loadAll(bookIds: string[]): Record<string, BookEmbedding>;
  /** 清掉一本书的向量与对应阶段计数。 */
  drop(bookId: string, keepEmbedIndexId: number | null): void;
}

/** 向量索引注册表的持久化接口。 */
export interface EmbedIndexRepo {
  /** 按模型指纹查询。 */
  findByFingerprint(fingerprint: string): EmbedIndex | undefined;
  /** 按主键查询。 */
  findById(id: number): EmbedIndex | undefined;
  /** 全部索引。 */
  listAll(): EmbedIndex[];
  /** 按模型标识查询。 */
  listByModelId(modelId: string): EmbedIndex[];
  /** 注册一套模型参数。 */
  create(data: EmbedIndexInsert): EmbedIndex;
  /** 记录最近使用时间。 */
  touch(id: number, usedAt: number, label?: string): void;
}

/** 运行时创建的向量表读写接口。 */
export interface EmbedVectorRepo {
  /** 确保向量表存在，返回物理描述。 */
  ensureTable(dimension: number, fingerprint: string): VectorTableRef;
  /** 批量写入向量。 */
  insertBatch(ref: VectorTableRef, rows: readonly InsertVectorRow[]): void;
  /** 某个资源已有的向量数。 */
  countBySource(tableName: string, sourceId: string): number;
  /** 按资源聚合向量数。 */
  aggregateBySource(tableName: string): VectorCountBySource[];
  /** 在向量表里检索。 */
  searchBySource(
    ref: VectorTableRef,
    sourceId: string,
    queryValues: readonly number[],
    topK: number
  ): VectorSearchHit[];
  /** 取一本书待处理的分片。 */
  listPendingBookChunks(tableName: string, bookId: string, limit: number): PendingChunk[];
  /** 删除某个资源的全部向量。 */
  deleteBySource(tableName: string, sourceType: EmbedSourceType, sourceId: string): void;
}
