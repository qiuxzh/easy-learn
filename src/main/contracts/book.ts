import type { BookType } from '@shared/types/books';
import type { BookPageBlock } from '@shared/types/ocr';

/** 书籍的处理阶段。闭合集合，新增阶段时在这里扩。 */
export type BookStage = 'ocr' | 'chunk' | 'embed';

/** 书籍实体，不含文件落盘位置。 */
export interface BookEntity {
  id: string;
  booksName: string;
  booksType: BookType;
  coverAttachment: string | null;
  totalPages: number | null;
  totalChapters: number | null;
  description: string | null;
  author: string | null;
  createdAt: number;
}

/** 新建书籍时提供的字段；`booksStoreName` 是落盘文件名，只由仓储写入。 */
export interface BookCreate {
  id?: string;
  booksName: string;
  booksStoreName: string;
  booksType: BookType;
  coverAttachment?: string | null;
  totalPages?: number | null;
  totalChapters?: number | null;
  description?: string | null;
  author?: string | null;
  createdAt?: number;
}

/** 书籍阶段进度的一条记录。 */
export interface BookStageProgress {
  bookId: string;
  stage: BookStage;
  total: number | null;
  done: number | null;
  identity: string | null;
  lastError: string | null;
  updatedAt: number;
}

/** 正文分片记录。 */
export interface BookChunkEntity {
  id: string;
  bookId: string;
  segmentIndex: number;
  segmentId: string;
  chunkIndex: number;
  content: string;
  locatorStart: string;
  locatorEnd: string;
}

/** 切分产物落库需要的最小字段。 */
export interface BookChunkDraft {
  segmentIndex: number;
  segmentId: string;
  chunkIndex: number;
  content: string;
  locatorStart: string;
  locatorEnd: string;
}

/** 按书聚合的分片数。 */
export interface BookChunkCount {
  bookId: string;
  count: number;
}

/** 一页的 OCR 结果。 */
export interface BookPageContent {
  page: number;
  blocks: BookPageBlock[];
}

/** 写入一页 OCR 结果所需的字段。 */
export interface BookPageWrite {
  bookId: string;
  page: number;
  blocks: BookPageBlock[];
  updatedAt: number;
}

/** 嵌入阶段推进需要的最小字段。 */
export interface EmbedStageWrite {
  bookId: string;
  total: number;
  identity: string;
}

/** 向量索引注册表记录。 */
export interface EmbedIndex {
  id: number;
  fingerprint: string;
  tableName: string;
  modelId: string;
  dimension: number;
  lastLabel: string | null;
  createdAt: number;
  lastUsedAt: number;
}

/** 写入向量索引注册表所需的字段。 */
export interface EmbedIndexInsert {
  id?: number;
  fingerprint: string;
  tableName: string;
  modelId: string;
  dimension: number;
  lastLabel?: string | null;
  createdAt: number;
  lastUsedAt: number;
}

/** 可做向量化的资源类型。 */
export type EmbedSourceType = 'book' | 'flashcard';

/** 一张向量表的物理描述。 */
export interface VectorTableRef {
  tableName: string;
  dimension: number;
}

/** 待处理的分片：只有它当前的内容，不含任何向量。 */
export interface PendingChunk {
  chunkId: string;
  content: string;
}

/** 写入一行向量所需的数据。 */
export interface InsertVectorRow {
  chunkId: string;
  sourceId: string;
  sourceType: EmbedSourceType;
  /** Float32 紧凑排列的向量字节，长度必须等于 dimension * 4 */
  vector: Buffer;
}

/** 按资源聚合的数量。 */
export interface VectorCountBySource {
  sourceId: string;
  count: number;
}

/** 一次向量命中的标识与距离。 */
export interface VectorSearchHit {
  documentId: string;
  distance: number;
}
