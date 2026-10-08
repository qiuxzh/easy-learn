/** 向量端点测试请求。 */
export interface TestEmbeddingEndpointRequest {
  /** 完整的 embeddings 请求地址 */
  endpoint: string;
  /** 请求时传给接口的 model 名 */
  modelId: string;
  /** 接口密钥，本地服务可以留空 */
  apiKey?: string;
}

/** 向量端点测试结果。 */
export interface TestEmbeddingEndpointResult {
  success: boolean;
  /** 接口返回的向量维度，成功时存在 */
  dimension?: number;
  /** 失败原因，成功时不存在 */
  error?: string;
}
