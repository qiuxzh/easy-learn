import { embedTexts } from '@main/books/etl/embedding';
import { DomainError } from '@main/domain-error';
import type { TestEmbeddingEndpointRequest } from '@shared/types/embedding';

/** 连通性测试的超时时间。比批量向量化短得多——它只是为了给用户一个即时的成败反馈。 */
const TEST_TIMEOUT_MS = 15000;

/** 向量化调用，注入后测试可以替换成任意实现。 */
export type EmbedTexts = typeof embedTexts;

/** 创建 EmbeddingService 所需的依赖。 */
export interface EmbeddingServiceDeps {
  /** 向量化调用；省略时用真实实现。 */
  embed?: EmbedTexts;
}

/**
 * 向量模型服务。
 *
 */
export class EmbeddingService {
  private readonly embed: EmbedTexts;

  constructor(deps: EmbeddingServiceDeps = {}) {
    this.embed = deps.embed ?? embedTexts;
  }

  /**
   * 用一条短文本探一次接口。
   *
   * @param request 端点、模型与密钥
   * @returns 接口给出的向量维度
   * @throws DomainError 接口不可用，message 为接口给出的原因
   */
  async testEndpoint(request: TestEmbeddingEndpointRequest): Promise<{ dimension: number }> {
    const result = await this.embed(
      {
        endpoint: request.endpoint ?? '',
        modelId: request.modelId ?? '',
        apiKey: request.apiKey,
      },
      ['test embedding'],
      // 连通性测试要的是即时反馈：失败就直接告诉用户，不要退避重试把等待拖长
      { timeoutMs: TEST_TIMEOUT_MS, maxAttempts: 1 }
    );
    if (!result.ok) throw new DomainError(result.message);
    return { dimension: result.dimension };
  }
}
