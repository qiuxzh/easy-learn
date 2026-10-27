import { rm } from 'node:fs/promises';
import path from 'node:path';
import { AuthError, FileNotFoundError, InvalidRequestError } from '@paddleocr/api-sdk';
import log from 'electron-log';
import { Constants } from '@main/constants';
import { configService } from '@main/config';
import { runInTransaction } from '@main/db';
import { bookPageRepo, bookRepo, bookStageRepo } from '@main/db/repo';
import type { BookPageBlock, OcrCommandResult, OcrEvent, OcrRuntime } from '@shared/types/ocr';
import { attachmentService } from '@main/service/attachment-service';
import { DEFAULT_CHUNK_OPTIONS, chunkDocument, createPdfSource } from './etl/chunking';
import type { PdfTextReport } from './etl/pdf/text-layer';
import { OCR_MODEL_ID, OcrClient, isRetryableOcrError } from './etl/ocr/paddle/client';
import { parsePaddleResult } from './etl/ocr/paddle/parser';
import { mergePageBlocks, type OcrImage, type OcrPageResult } from './etl/ocr/result';
import { splitPdf, type PdfChunk } from './etl/pdf/split';
import { replaceBookChunks } from './book-content';

/** 配置缺省时的分块页数与并发数。 */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;

/** 单块失败后的重试次数（整块重新提交）。 */
const CHUNK_ATTEMPTS = 3;

/** 重试的基础退避；第 n 次重试等待 RETRY_BASE_DELAY_MS * 2^n。 */
const RETRY_BASE_DELAY_MS = 1000;

/** 识别过程中的内存运行态；重启不需要恢复。 */
interface RuntimeState {
  bookId: string;
  bookFile: string;
  phase: OcrRuntime['phase'];
  total: number;
  done: number;
  cancelled: boolean;
  /** 正在处理的块：键是块起始页，值是服务端已处理页数 */
  active: Map<number, number>;
}

/**
 * OCR 编排：切片、并发提交、逐块落库、自动分片。
 *
 * 同一时刻只允许一本书在跑；书内按配置并发若干块。
 * 取消只在块边界生效——在飞的块会跑完并落库，服务端任务本来也停不掉。
 */
export class BookOcrRunner {
  private state: RuntimeState | null = null;
  private readonly bookDir: string;

  constructor(private readonly onEvent: (event: OcrEvent) => void) {
    this.bookDir = Constants.booksDir;
  }

  /** 当前运行态；没有任务时为空。 */
  describe(): OcrRuntime | null {
    return this.state ? this.toRuntime(this.state) : null;
  }

  /** 开始识别。校验同步完成，真正的工作异步跑，接口立刻返回。 */
  start(bookId: string): OcrCommandResult {
    // TODO 不应该全局只有一本书 ocr，应该使用队列等实现。后续实现
    if (this.state) {
      return { success: false, error: '另一本书正在识别，请稍后再试' };
    }

    const book = bookRepo.findById(bookId);
    if (!book) return { success: false, error: '书籍不存在' };
    if (book.booksType !== 'pdf') return { success: false, error: '只有 PDF 需要提取文字' };
    if (!readOcrToken()) return { success: false, error: '请先在设置页配置 OCR 令牌' };

    this.state = {
      bookId,
      bookFile: path.join(this.bookDir, book.booksStoreName),
      phase: 'running',
      total: book.totalPages ?? 0,
      done: bookPageRepo.countPages(bookId),
      cancelled: false,
      active: new Map(),
    };
    this.emitRuntime();

    void this.run(bookId);
    return { success: true };
  }

  /** 请求取消：不再派发新块 */
  cancel(): OcrCommandResult {
    if (!this.state) return { success: false, error: '没有正在进行的提取' };
    if (this.state.phase === 'cancelling') return { success: true };

    this.state.cancelled = true;
    this.state.phase = 'cancelling';
    this.emitRuntime();
    return { success: true };
  }

  /** 识别的完整流程；结束时一定清掉运行态并广播结果。 */
  private async run(bookId: string): Promise<void> {
    const state = this.state;
    if (!state) return;

    const { pageSize, concurrency } = this.readConfig();
    const workDir = path.join(Constants.dataDir, 'ocr-work', bookId);

    let success = false;
    let cancelled = false;
    let error: string | undefined;

    try {
      const existing = bookPageRepo.listPageNumbers(bookId);
      // pdf拆分多个块
      const { pageCount, chunks } = await splitPdf(state.bookFile, pageSize, workDir);

      state.total = pageCount;
      state.done = existing.size;
      this.emitRuntime();

      const pending = chunks.filter(chunk => !isChunkDone(chunk, existing));
      const failure = await this.runChunks(state, pending, concurrency);

      if (state.cancelled) {
        cancelled = true;
        return;
      }
      if (failure) throw failure;

      bookStageRepo.setOcrComplete(bookId, pageCount, OCR_MODEL_ID);
      this.emitRuntime();

      try {
        await this.chunkPages(bookId);
        success = true;
      } catch (chunkError) {
        // 识别本身已经成功：分片失败要记在分片阶段，不能把识别也标成失败
        const message = toError(chunkError).message;
        bookStageRepo.setStageError(bookId, 'chunk', message);
        error = `文字提取完成，但分片失败：${message}`;
      }
    } catch (runError) {
      error = toError(runError).message;
      bookStageRepo.setStageError(bookId, 'ocr', error);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      this.state = null;
      this.emitRuntime();
      this.onEvent({ kind: 'finished', bookId, success, cancelled, error });
    }
  }

  /** 并发跑完所有块；返回第一个错误（没有错误时为 null）。 */
  private async runChunks(
    state: RuntimeState,
    chunks: PdfChunk[],
    concurrency: number
  ): Promise<Error | null> {
    const queue = [...chunks];
    const client = new OcrClient(readOcrToken() ?? '');
    let failure: Error | null = null;

    const worker = async (): Promise<void> => {
      while (!state.cancelled && !failure) {
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          await this.runChunk(client, state, chunk);
        } catch (chunkError) {
          failure ??= toError(chunkError);
        }
      }
    };

    const workerCount = Math.min(concurrency, chunks.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return failure;
  }

  /** 跑一个块：提交、轮询、映射、落库。整块失败会重新提交（最多三次）。 */
  private async runChunk(client: OcrClient, state: RuntimeState, chunk: PdfChunk): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      try {
        // 块内只重试瞬时错误：提交与轮询各自重来，不会重跑整块
        const jobId = await this.withRetry(() => client.submit(chunk.filePath), '提交');
        const result = await this.withRetry(
          () => client.wait(jobId, extracted => this.reportProgress(state, chunk, extracted)),
          '轮询'
        );

        await this.persistPages(state.bookId, parsePaddleResult(result, chunk.start));
        state.done = bookPageRepo.countPages(state.bookId);
        state.active.delete(chunk.start);
        this.emitRuntime();
        return;
      } catch (error) {
        lastError = error;
        // 鉴权、文件不存在这类错误重试也不会变，直接把原因抛出去
        if (
          error instanceof AuthError ||
          error instanceof FileNotFoundError ||
          error instanceof InvalidRequestError ||
          attempt === CHUNK_ATTEMPTS - 1
        ) {
          throw error;
        }
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError;
  }

  /**
   * 对可重试错误做指数退避重试；不可重试或最后一次失败直接抛出。
   *
   * 每次重试都写日志：重试是块内的行为，不往外冒泡，不记录就没人知道发生过。
   */
  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableOcrError(error) || attempt === CHUNK_ATTEMPTS - 1) throw error;

        log.warn(`[OCR] ${label}失败，准备第 ${attempt + 1} 次重试`, error);
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError;
  }

  /** 把一块的页写进库：先删同页再插，保证重跑幂等；附件失败只记日志。 */
  private async persistPages(bookId: string, pages: OcrPageResult[]): Promise<void> {
    const createdAttachments: string[] = [];
    const blockRows: BookPageBlock[][] = [];

    for (const page of pages) {
      const images: Array<{ bbox: OcrImage['bbox']; attachmentId: string }> = [];
      for (const image of page.images) {
        try {
          const attachmentId = await this.storeImage(image);
          createdAttachments.push(attachmentId);
          images.push({ bbox: image.bbox, attachmentId });
        } catch (error) {
          // 单张图失败不拖累文字：插图可以以后再补，正文丢了要重新付费识别
          log.warn(`[OCR] 插图保存失败，跳过：${image.name}`, error);
        }
      }
      blockRows.push(mergePageBlocks(page.blocks, images));
    }

    const now = Date.now();
    const rows = pages.map((page, index) => ({
      bookId,
      page: page.page,
      blocks: JSON.stringify(blockRows[index]),
      updatedAt: now,
    }));
    const pageNumbers = pages.map(page => page.page);

    try {
      runInTransaction(() => {
        bookPageRepo.deletePages(bookId, pageNumbers);
        bookPageRepo.insertMany(rows);
        bookStageRepo.setOcrDone(bookId, bookPageRepo.countPages(bookId));
      });
    } catch (error) {
      // 落库失败时把刚登记的附件删掉，避免留下没有归属的图
      await attachmentService.deleteAttachments(createdAttachments);
      throw error;
    }
  }

  /** 下载一张图并登记为附件，返回附件 id。原样保存，不压缩。 */
  private async storeImage(image: OcrImage): Promise<string> {
    // 签名地址有时会卡住，给一个上限，避免一个坏 URL 拖死整块
    const response = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`插图下载失败：HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const stored = await attachmentService.storeImageOriginal(
      bytes,
      response.headers.get('content-type') ?? 'image/png'
    );
    return stored.attachmentId;
  }

  /**
   * 识别完成后按页分片。
   *
   * 复用文字层 PDF 的文档源：每页文本拼好后当成一个 PDF 文本报告，
   * 定位串、切分规则与导入时完全一致，没有第二条路径。
   */
  private async chunkPages(bookId: string): Promise<void> {
    const pages = bookPageRepo.listBlocks(bookId);
    if (pages.length === 0) return;

    const report: PdfTextReport = {
      pageCount: pages.length,
      pages: pages.map(page => ({ page: page.page, text: blocksToText(page.blocks) })),
    };

    const drafts = await chunkDocument(createPdfSource(report), DEFAULT_CHUNK_OPTIONS);
    replaceBookChunks(bookId, drafts);
  }

  /** 更新某块的进度并广播。 */
  private reportProgress(state: RuntimeState, chunk: PdfChunk, extracted: number): void {
    const size = chunk.end - chunk.start + 1;
    state.active.set(chunk.start, Math.min(extracted, size));
    this.emitRuntime();
  }

  private emitRuntime(): void {
    this.onEvent({ kind: 'runtime', runtime: this.describe() });
  }

  private toRuntime(state: RuntimeState): OcrRuntime {
    let inFlight = 0;
    for (const extracted of state.active.values()) inFlight += extracted;

    return {
      bookId: state.bookId,
      phase: state.phase,
      done: state.done,
      total: state.total,
      extracted: state.done + inFlight,
    };
  }

  /** 读分块配置。 */
  private readConfig(): { pageSize: number; concurrency: number } {
    const ocr = configService.get('ocr');
    return {
      pageSize: clamp(ocr?.pageSize ?? DEFAULT_PAGE_SIZE, 1, 500),
      concurrency: clamp(ocr?.concurrency ?? DEFAULT_CONCURRENCY, 1, 8),
    };
  }
}

/** 块里的每一页都已经有结果时，这一块就跳过。 */
function isChunkDone(chunk: PdfChunk, existing: Set<number>): boolean {
  for (let page = chunk.start; page <= chunk.end; page += 1) {
    if (!existing.has(page)) return false;
  }
  return true;
}

/** 把页块转成分片用的纯文本：图片块没有文字，跳过；表格的 HTML 原样保留。 */
function blocksToText(blocks: BookPageBlock[]): string {
  return blocks
    .filter((block): block is Extract<BookPageBlock, { text: string }> => block.type !== 'image')
    .map(block => block.text)
    .join('\n');
}

/** 读配置里的令牌；空串与缺失都视为未配置。 */
function readOcrToken(): string | null {
  const token = configService.get('ocr')?.['paddle-ocr']?.token?.trim();
  return token ? token : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
