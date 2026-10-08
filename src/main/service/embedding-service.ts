import { ipcMain, net } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  TestEmbeddingEndpointRequest,
  TestEmbeddingEndpointResult,
} from '@shared/types/embedding';
import { BaseService } from './base-service';

/** 端点测试的超时时间，避免接口无响应时一直等待 */
const TEST_TIMEOUT_MS = 15000;

/** 测试用的输入文本 */
const TEST_INPUT = 'ping';

/** 失败时回显的响应体长度上限，防止把整段 HTML 错误页塞进提示 */
const ERROR_BODY_LIMIT = 200;

/** embeddings 接口响应中我们关心的部分 */
interface EmbeddingResponseBody {
  data?: Array<{ embedding?: unknown }>;
}

/** 从响应体里取出向量维度；结构不符合 OpenAI 兼容格式时返回 undefined */
function readEmbeddingDimension(payload: unknown): number | undefined {
  const data = (payload as EmbeddingResponseBody | null)?.data;
  const embedding = data?.[0]?.embedding;
  return Array.isArray(embedding) ? embedding.length : undefined;
}

/**
 * 向量模型服务：负责 embeddings 接口的调用。
 * 目前只提供设置页的端点连通性测试，批量向量化后续接入。
 */
export class EmbeddingService extends BaseService {
  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Embedding_TestEndpoint, (_event, req: TestEmbeddingEndpointRequest) =>
      this.testEndpoint(req)
    );
  }

  /**
   * 调用一次 embeddings 接口，返回接口给出的向量维度。
   * 失败时返回 error 而不是抛异常，避免渲染层拿到 IPC 包装后的报错前缀。
   */
  async testEndpoint(req: TestEmbeddingEndpointRequest): Promise<TestEmbeddingEndpointResult> {
    const endpoint = req.endpoint?.trim();
    const modelId = req.modelId?.trim();
    if (!endpoint) return { success: false, error: '请先填写 embeddings 请求地址' };
    if (!modelId) return { success: false, error: '请先填写模型 id' };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = req.apiKey?.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      // 用 net.fetch 而不是全局 fetch，才能走系统代理与系统证书
      response = await net.fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: [TEST_INPUT], model: modelId, encoding_format: 'float' }),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { success: false, error: `请求失败：${reason}` };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body ? `：${body.slice(0, ERROR_BODY_LIMIT)}` : '';
      return { success: false, error: `接口返回 HTTP ${response.status}${detail}` };
    }

    const payload = await response.json().catch(() => null);
    const dimension = readEmbeddingDimension(payload);
    if (!dimension) {
      return {
        success: false,
        error: '接口响应中没有向量数据，请确认地址指向 OpenAI 兼容的 embeddings 接口',
      };
    }

    return { success: true, dimension };
  }
}

export const embeddingService = new EmbeddingService();
