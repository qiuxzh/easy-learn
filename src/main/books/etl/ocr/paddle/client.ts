import {
  Model,
  NetworkError,
  PaddleOCRClient,
  RateLimitError,
  ServiceUnavailableError,
  type DocParsingResult,
} from '@paddleocr/api-sdk';

/**
 * PaddleOCR 的请求侧：提交、轮询、取结果。
 *
 * 不重试：失败直接抛出，由调用方决定是否重来。
 */

/** 服务端识别模型。只用于记录阶段身份，不参与可用性判断。 */
export const OCR_MODEL_ID = 'paddleocr-vl-1.6';

/** 轮询间隔。任务通常十几秒到几分钟，三秒足够细。 */
const POLL_INTERVAL_MS = 3000;

/** 单次 HTTP 请求超时（含上传）。大文件上传可能很慢。 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** PaddleOCR 的薄封装：只做「提交、轮询、取结果」三件事。 */
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
   * @returns 服务端任务 id
   * @throws 网络、限流、鉴权等请求错误
   */
  async submit(filePath: string): Promise<string> {
    const job = await this.client.submitDocumentParsing({
      filePath,
      model: Model.PaddleOCRVL16,
      options: {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
      },
    });
    return job.jobId;
  }

  /**
   * 轮询到任务结束并取回结果。
   *
   * 没有整体超时：只要服务端不给终态就一直等，终止由调用方负责。
   *
   * @param onProgress 每轮把服务端已处理的页数报给调用方
   * @throws 任务失败，或轮询请求出错
   */
  async wait(
    jobId: string,
    onProgress?: (extractedPages: number) => void
  ): Promise<DocParsingResult> {
    for (;;) {
      const status = await this.client.getStatus(jobId);

      if (status.state === 'failed') {
        throw new Error(status.errorMsg ?? '识别任务失败');
      }
      if (status.state === 'done') break;

      if (status.progress) {
        onProgress?.(status.progress.extractedPages);
      }
      await sleep(POLL_INTERVAL_MS);
    }

    return this.client.waitDocumentParsingResult(jobId);
  }
}

/**
 * 这些错误说明请求本身可以重来：限流、服务不可用、网络。
 * 鉴权、参数非法、文件不存在等重试也不会变。
 */
export function isRetryableOcrError(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof ServiceUnavailableError ||
    error instanceof NetworkError
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
