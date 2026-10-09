/**
 * 向量模型服务：只负责设置页的端点连通性测试。
 *
 * 向量化任务本身是**书的逻辑**——它由 `book-service` 注册 IPC、由 `BookEmbeddingQueue` 执行。
 * 这里只剩「这套模型参数能不能用」这一件事，它属于模型配置，不属于任何一本书。
 */
import { ipcMain } from 'electron';
import { embedTexts } from '@main/books/etl/embedding';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  TestEmbeddingEndpointRequest,
  TestEmbeddingEndpointResult,
} from '@shared/types/embedding';
import { BaseService } from './base-service';

/** 连通性测试的超时时间。比批量向量化短得多——它只是为了给用户一个即时的成败反馈。 */
const TEST_TIMEOUT_MS = 15000;

export class EmbeddingService extends BaseService {
  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Embedding_TestEndpoint, (_event, req: TestEmbeddingEndpointRequest) =>
      this.testEndpoint(req)
    );
  }

  /**
   * 用一条短文本探一次接口，返回接口给出的向量维度。
   * 失败时返回 error 而不是抛异常，避免渲染层拿到 IPC 包装后的报错前缀。
   */
  async testEndpoint(req: TestEmbeddingEndpointRequest): Promise<TestEmbeddingEndpointResult> {
    const result = await embedTexts(
      { endpoint: req.endpoint ?? '', modelId: req.modelId ?? '', apiKey: req.apiKey },
      ['test embedding'],
      // 连通性测试要的是即时反馈：失败就直接告诉用户，不要退避重试把等待拖长
      { timeoutMs: TEST_TIMEOUT_MS, maxAttempts: 1 }
    );
    if (!result.ok) {
      return { success: false, error: result.message };
    }
    return { success: true, dimension: result.dimension };
  }
}

export const embeddingService = new EmbeddingService();
