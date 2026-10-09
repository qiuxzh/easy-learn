import type { RetrievalDocument } from '../types';

/** 倒排表里的一条记录：某个文档出现了某个词多少次。 */
export interface Posting {
  documentId: string;
  termFrequency: number;
}

/** 一个词在全部文档中的索引项。 */
export interface TermIndexEntry {
  /** 出现该词的文档数 */
  documentFrequency: number;
  /** 由文档数与文档总数算出的 IDF，建索引时一次算好 */
  inverseDocumentFrequency: number;
  /** 该词在各文档中的词频 */
  postings: Posting[];
}

/** 单个文档的索引元信息。 */
export interface DocumentMeta {
  /** 分词后的 token 数，BM25 长度归一化的输入 */
  tokenLength: number;
  /**
   * 文档在构建输入中的下标。
   * 同分时用它兜底排序，所以它同时表达了调用方期望的展示顺序。
   */
  order: number;
}

/**
 * 一批文档的内存 BM25 索引。
 *
 * 泛型参数是调用方的文档类型，索引内部只把它当作 RetrievalDocument 使用；
 * 命中时原样还回去，调用方因此不必二次回查原始数据。
 */
export interface Bm25Index<T extends RetrievalDocument> {
  documentsById: Map<string, T>;
  documentMetaById: Map<string, DocumentMeta>;
  terms: Map<string, TermIndexEntry>;
  /** 文档总数，IDF 的分母 */
  totalDocuments: number;
  /** 平均文档长度，长度归一化的基准 */
  averageDocumentLength: number;
}
