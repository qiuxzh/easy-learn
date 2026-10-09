/**
 * 检索域的对外契约。
 *
 * 这里只定义「检索层认识的文档长什么样」与「一次命中长什么样」，
 * 不含任何检索算法，也不含任何数据来源——BM25 与向量检索都实现这套契约。
 */

/** 检索层认识的唯一文档形态；调用方的行类型只需在结构上满足它。 */
export interface RetrievalDocument {
  /** 文档标识，命中后调用方靠它回查原始数据 */
  id: string;
  /** 参与检索的正文 */
  content: string;
}

/**
 * 一次命中。
 *
 * `score` 的方向由具体检索器决定（BM25 越大越相关），**混合检索时不要跨检索器直接比较 score**：
 * 两种分数的尺度不可比，融合应当用排名（RRF）而不是加权求和。
 */
export interface RetrievalHit<T extends RetrievalDocument> {
  document: T;
  score: number;
}
