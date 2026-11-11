import {
  APIError,
  AuthError,
  FileNotFoundError,
  InvalidRequestError,
  Model,
  NetworkError,
  PaddleOCRClient,
  RateLimitError,
  ServiceUnavailableError,
  type DocParsingResult,
} from '@paddleocr/api-sdk';
import { log } from '@main/logging';

/**
 * PaddleOCR 的请求侧：提交、轮询、取结果，以及块级重试。
 *
 * 一个「块」是一次提交到取回结果的完整过程；瞬时错误在块内重试，
 * 鉴权、文件不存在、参数非法这类错误直接抛出。
 */

/** 服务端识别模型。只用于记录阶段身份，不参与可用性判断。 */
export const OCR_MODEL_ID = 'paddleocr-vl-1.6';

/** 轮询间隔。任务通常十几秒到几分钟，三秒足够细。 */
const POLL_INTERVAL_MS = 3000;

/** 单次 HTTP 请求超时（含上传）。大文件上传可能很慢。 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** 提交与轮询各自的重试次数；用完仍失败则整块重来。 */
const RETRY_ATTEMPTS = 3;

/** 一个块整体重新提交的次数。 */
const CHUNK_ATTEMPTS = 3;

/** 重试的基础退避；第 n 次重试等待 RETRY_BASE_DELAY_MS * 2^n。 */
const RETRY_BASE_DELAY_MS = 1000;

/** PaddleOCR 的薄封装：提交、轮询、取结果与块级重试。 */
export class OcrClient {
  private readonly client: PaddleOCRClient;

  constructor(token: string) {
    this.client = new PaddleOCRClient({
      token,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * 提交一个块文件。
   *
   * @param filePath 待识别的块文件
   * @param signal 取消信号；中止时请求尽快结束
   * @returns 服务端任务 id
   * @throws 网络、限流、鉴权等请求错误
   */
  async submit(filePath: string, signal?: AbortSignal): Promise<string> {
    const job = await this.client.submitDocumentParsing(
      {
        filePath,
        model: Model.PaddleOCRVL16,
        options: {
          useDocOrientationClassify: false,
          useDocUnwarping: false,
          useChartRecognition: false,
        },
      },
      signal ? { signal } : undefined
    );
    return job.jobId;
  }

  /**
   * 轮询到任务结束并取回结果。
   *
   * 没有整体超时：只要服务端不给终态就一直等，终止由调用方负责。
   *
   * @param jobId 服务端任务 id
   * @param onProgress 每轮把服务端已处理的页数报给调用方
   * @param signal 取消信号；中止时停止轮询并抛出
   * @throws 任务失败、轮询请求出错或被中止
   */
  async wait(
    jobId: string,
    onProgress?: (extractedPages: number) => void,
    signal?: AbortSignal
  ): Promise<DocParsingResult> {
    for (;;) {
      signal?.throwIfAborted();
      const status = await this.client.getStatus(jobId, signal ? { signal } : undefined);

      if (status.state === 'failed') {
        throw new Error(status.errorMsg ?? '识别任务失败');
      }
      if (status.state === 'done') break;

      if (status.progress) {
        onProgress?.(status.progress.extractedPages);
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }

    return this.client.waitDocumentParsingResult(jobId, signal ? { signal } : undefined);
  }

  /**
   * 跑完一个块：提交、轮询、取结果，失败时按退避重试。
   *
   * 提交和轮询先各自重试瞬时错误；整块仍失败时重新提交，最多 {@link CHUNK_ATTEMPTS} 次。
   * 鉴权、文件不存在、参数非法不重试。
   *
   * @param filePath 待识别的块文件
   * @param onProgress 每轮把服务端已处理的页数报给调用方
   * @param signal 取消信号；中止时立即停止重试
   * @returns 服务端的识别结果
   * @throws 不可重试错误、重试耗尽或被中止
   */
  async run(
    filePath: string,
    onProgress?: (extractedPages: number) => void,
    signal?: AbortSignal
  ): Promise<DocParsingResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      signal?.throwIfAborted();
      try {
        const jobId = await this.withRetry(() => this.submit(filePath, signal), '提交', signal);
        return await this.withRetry(() => this.wait(jobId, onProgress, signal), '轮询', signal);
      } catch (error) {
        lastError = error;
        if (signal?.aborted || isPermanentOcrError(error) || attempt === CHUNK_ATTEMPTS - 1) {
          throw error;
        }
        log.warn(`[OCR] 识别块失败，准备第 ${attempt + 1} 次整块重试`, error);
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
      }
    }

    throw lastError;
  }

  /**
   * 对瞬时错误做指数退避重试。
   *
   * @param operation 提交或轮询
   * @param label 日志里的阶段名
   * @param signal 取消信号
   * @throws 不可重试、重试耗尽或被中止
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    label: string,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (signal?.aborted || !isRetryableOcrError(error) || attempt === RETRY_ATTEMPTS - 1) {
          throw error;
        }
        log.warn(`[OCR] ${label}失败，准备第 ${attempt + 1} 次重试`, error);
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
      }
    }

    throw lastError;
  }
}

/**
 * 这些错误说明请求本身可以重来：限流、服务不可用、网络，以及 5xx。
 * 鉴权、参数非法、文件不存在等重试也不会变。
 */
export function isRetryableOcrError(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof ServiceUnavailableError ||
    error instanceof NetworkError ||
    (error instanceof APIError && error.statusCode >= 500)
  );
}

/** 鉴权、文件不存在、参数非法：重试不会改变结果。 */
function isPermanentOcrError(error: unknown): boolean {
  return (
    error instanceof AuthError ||
    error instanceof FileNotFoundError ||
    error instanceof InvalidRequestError
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('任务已中止'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('任务已中止'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
