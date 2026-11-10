/** 调用 embeddings 接口所需的配置。 */
export interface EmbedClientConfig {
  /** 完整的 embeddings 请求地址，代码不做拼接 */
  endpoint: string;
  /** 请求时传给接口的 model 名 */
  modelId: string;
  /** 接口密钥；本地服务可以留空 */
  apiKey?: string;
}

/** 单次调用的可选参数。默认值适合批量向量化，连通性测试另行覆盖。 */
export interface EmbedCallOptions {
  /** 单次请求超时 */
  timeoutMs?: number;
  /** 总尝试次数，含首次。1 表示不重试 */
  maxAttempts?: number;
  /** 首次退避时长，之后翻倍 */
  backoffMs?: number;
}

/** 调用成功：向量顺序与入参严格一致。 */
export interface EmbedSuccess {
  ok: true;
  /** 与入参顺序一一对应的向量 */
  vectors: number[][];
  /** 本次响应给出的维度。首次给一个模型建表时要用它 */
  dimension: number;
}

/**
 * 调用失败。
 *
 * **不分「可重试」与「不可重试」**：分类要靠解析服务端的文案与错误码，各家都不一样，
 * 猜错反而会把可恢复的错误当成致命错误。一律重试有限次，代价只是几次多余的往返。
 */
export interface EmbedFailure {
  ok: false;
  /** 给人看的原因，会直接进界面 */
  message: string;
  /** 服务端返回的状态码；网络层失败时为空 */
  status?: number;
}

export type EmbedResult = EmbedSuccess | EmbedFailure;
