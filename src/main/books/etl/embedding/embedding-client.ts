/**
 * 兼容openai格式的embedding模型操作客户端
 */
import { net } from 'electron';
import type { EmbedCallOptions, EmbedClientConfig, EmbedFailure, EmbedResult } from './types';

/** 批量调用的默认超时。一次几十条文本，比设置页的连通性测试慢得多。 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** 默认总尝试次数，含首次。 */
const DEFAULT_MAX_ATTEMPTS = 4;

/** 默认首次退避时长，之后翻倍：1s → 2s → 4s。 */
const DEFAULT_BACKOFF_MS = 1_000;

/** 失败时回显的响应体长度上限，防止把整段 HTML 错误页塞进提示。 */
const ERROR_BODY_LIMIT = 300;

/** 接口响应里我们关心的部分。 */
interface RawEmbeddingItem {
  embedding?: unknown;
  index?: unknown;
}

/** 构造失败结果。 */
function fail(message: string, status?: number): EmbedFailure {
  return status === undefined ? { ok: false, message } : { ok: false, message, status };
}

/** 等待一段时间。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/** 网络层失败的原因。超时单独给一句人话，其余原样带出。 */
function describeNetworkError(error: unknown, timeoutMs: number): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError') {
    return `请求超时（${Math.round(timeoutMs / 1000)} 秒）`;
  }
  if (name === 'AbortError') {
    return '请求被中断';
  }
  return `请求失败：${error instanceof Error ? error.message : String(error)}`;
}

/** 解析结果：要么给出向量，要么给出人话原因。 */
type VectorOutcome = { ok: true; vectors: number[][] } | { ok: false; message: string };

/**
 * 从响应体里取出向量。
 *
 * 两点必须严格：**按 index 重排**（服务端可能并行处理，数组顺序不保证），
 * 以及**校验数量、维度与数值合法性**——向量错位挂到别的分片上是检索时才会暴露、
 * 且事后无法分辨的错误，必须在入口挡住。
 */
function readVectors(payload: unknown, expectedCount: number): VectorOutcome {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return {
      ok: false,
      message: '接口响应中没有向量数据，请确认地址指向 OpenAI 兼容的 embeddings 接口',
    };
  }
  if (data.length !== expectedCount) {
    return {
      ok: false,
      message: `接口返回 ${data.length} 条向量，与请求的 ${expectedCount} 条不一致`,
    };
  }

  const indexed = data.map((item, position) => {
    const record = item as RawEmbeddingItem | null;
    const index = typeof record?.index === 'number' ? record.index : position;
    return { index, embedding: record?.embedding };
  });
  indexed.sort((left, right) => left.index - right.index);

  const vectors: number[][] = [];
  let dimension = 0;
  for (let position = 0; position < indexed.length; position += 1) {
    const { embedding } = indexed[position];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, message: `第 ${position + 1} 条响应缺少向量数据` };
    }
    for (const value of embedding) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: `第 ${position + 1} 条响应包含非法数值` };
      }
    }
    if (dimension === 0) {
      dimension = embedding.length;
    } else if (embedding.length !== dimension) {
      return {
        ok: false,
        message: `同一批响应的向量维度不一致：${dimension} 与 ${embedding.length}`,
      };
    }
    vectors.push(embedding as number[]);
  }

  return { ok: true, vectors };
}

/** 发一次请求，不做任何重试。 */
async function callOnce(
  config: EmbedClientConfig,
  texts: string[],
  timeoutMs: number
): Promise<EmbedResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    // 用 net.fetch 而不是全局 fetch，才能走系统代理与系统证书
    response = await net.fetch(config.endpoint.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: texts,
        model: config.modelId.trim(),
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return fail(describeNetworkError(error, timeoutMs));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body ? `：${body.slice(0, ERROR_BODY_LIMIT)}` : '';
    return fail(`接口返回 HTTP ${response.status}${detail}`, response.status);
  }

  const payload = await response.json().catch(() => null);
  const outcome = readVectors(payload, texts.length);
  if (!outcome.ok) {
    return fail(outcome.message);
  }

  return { ok: true, vectors: outcome.vectors, dimension: outcome.vectors[0].length };
}

/**
 * 调用 OpenAI 兼容的 embeddings 接口。
 *
 * 一次请求带多条文本，入参是数组。**重试在本函数内部完成，而且不区分错误类型**：
 * 要判断「这个错误值不值得重试」只能去解析各家服务五花八门的文案与错误码，
 * 猜错的代价是把本可恢复的限流当成致命错误直接放弃。一律退避重试有限次，
 * 代价只是几次多余的往返——比猜错便宜得多。
 */
export async function embedTexts(
  config: EmbedClientConfig,
  texts: string[],
  options: EmbedCallOptions = {}
): Promise<EmbedResult> {
  const endpoint = config.endpoint?.trim() ?? '';
  const modelId = config.modelId?.trim() ?? '';
  if (!endpoint) return fail('请先填写 embeddings 请求地址');
  if (!modelId) return fail('请先填写模型 id');
  if (texts.length === 0) return fail('没有需要向量化的文本');

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  for (let attempt = 1; ; attempt += 1) {
    const result = await callOnce(config, texts, timeoutMs);
    if (result.ok || attempt >= maxAttempts) return result;

    await sleep(backoffMs);
    backoffMs *= 2;
  }
}
