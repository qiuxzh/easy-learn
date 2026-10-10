/**
 * 检索层认识的文档形态。
 *
 * 只有 BM25 用它。向量的检索算法在 `@sqliteai/sqlite-vector` 里、数据在 SQLite 里，
 * 我们这边没有算法可写，所以那一侧不进检索层（见 `books/book-retrieval.ts`）。
 */

/** 检索层认识的唯一文档形态；调用方的行类型只需在结构上满足它。 */
export interface RetrievalDocument {
  /** 文档标识，命中后调用方靠它回查原始数据 */
  id: string;
  /** 参与检索的正文 */
  content: string;
}
