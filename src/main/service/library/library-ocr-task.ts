import path from 'node:path';
import { log } from '@main/logging';
import type { OcrConfig } from '@main/contracts/config';
import type { Paths } from '@main/paths';
import type { TransactionRunner } from '@main/contracts/transaction';
import type { TaskContext, TaskDefinition } from '@main/contracts/task';
import { TaskFailure } from '@main/contracts/task';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { ResourceChunkRepo, ResourceOcrPageRepo } from '@main/contracts/resource-ocr-repo';
import type { ResourceOcrPage } from '@main/contracts/resource-ocr';
import type { PdfDocMeta } from '@shared/types/library';
import type { AttachmentService } from '@main/service/attachment-service';
import { createPdfSource } from '@main/service/etl/chunking';
import { OcrClient, isRetryableOcrError } from '@main/service/etl/ocr/paddle/client';
import { parsePaddleResult } from '@main/service/etl/ocr/paddle/parser';
import {
  mergePageBlocks,
  ocrBlocksToText,
  type OcrImage,
  type OcrPageResult,
} from '@main/service/etl/ocr/result';
import { readPdfInfo } from '@main/service/etl/pdf/inspect';
import type { PdfTextReport } from '@main/service/etl/pdf/pdf-pages';
import { splitPdf, type PdfChunk } from '@main/service/etl/pdf/split';
import { chunkResource } from './resource-chunking';
import { parsePdfDocMeta, patchPdfDocMeta } from './doc-meta';

/** 配置缺省时的分块页数与并发数。 */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;

export interface LibraryOcrTaskDeps {
  paths: Paths;
  transaction: TransactionRunner;
  ocrConfig: OcrConfig;
  resourceRepo: ResourceRepo;
  pageRepo: ResourceOcrPageRepo;
  chunkRepo: ResourceChunkRepo;
  attachmentService: AttachmentService;
}

/**
 * 创建 PDF 文字识别任务。
 *
 * 一个任务处理一个资料；块内并发由 OCR 配置决定，块之间互不依赖。
 * 续跑依据是 `resource_ocr_page` 里已经落库的页，不依赖任务行。
 */
export function createLibraryOcrTask(deps: LibraryOcrTaskDeps): TaskDefinition {
  return {
    taskType: 'ocr-pdf',
    maxConcurrency: 2,
    timeoutMs: 2 * 60 * 60 * 1000,
    run: async ctx => {
      try {
        await runPdfOcr(deps, ctx);
      } catch (error) {
        throw toTaskFailure(error);
      }
    },
  };
}

/**
 * 识别主流程：检查 PDF → 切块 → 并发提交 → 逐块落页 → 分片。
 *
 * 文本层不是跳过条件：有文本层的 PDF 也按同样流程识别。
 *
 * @throws {@link TaskFailure} 资料缺失、未配置令牌或识别失败
 */
async function runPdfOcr(deps: LibraryOcrTaskDeps, ctx: TaskContext): Promise<void> {
  const resourceId = readResourceId(ctx.payload);
  const resource = deps.resourceRepo.findById(resourceId);
  if (!resource || resource.kind !== 'file' || resource.format !== 'pdf' || !resource.blobPath) {
    throw new TaskFailure('NO_RESOURCE', '资料不存在或不是 PDF 文件', false);
  }

  const filePath = path.join(deps.paths.dataDir, resource.blobPath);
  const config = readOcrConfig(deps.ocrConfig);
  if (!config.token) {
    throw new TaskFailure('INVALID_TOKEN', '请先在设置页配置 OCR 令牌', false);
  }

  const meta = await ensureDocMeta(deps, resourceId, filePath);

  // 读取已经完成的，防止每次都重新开始
  const existing = new Set(deps.pageRepo.listPageNumbers(resourceId));
  // pdf 切片
  const { pageCount, chunks } = await splitPdf(filePath, config.pageSize, ctx.workspaceDir);
  if (pageCount !== meta.pageCount) {
    // 数据不一致以最新的为准；局部回写，保留导入时算好的 toc
    patchPdfDocMeta(deps.resourceRepo, resourceId, { pageCount });
  }
  ctx.report(existing.size, pageCount);

  const pending = chunks.filter(chunk => !isChunkDone(chunk, existing));

  if (pending.length > 0) {
    await runChunks(deps, ctx, pending, pageCount, {
      token: config.token,
      concurrency: config.concurrency,
    });
  }
  ensureNotAborted(ctx);

  await replaceChunks(deps, resourceId);
}

/** 并发跑完未完成的块；任一失败即停止派发新块。 */
async function runChunks(
  deps: LibraryOcrTaskDeps,
  ctx: TaskContext,
  chunks: readonly PdfChunk[],
  total: number,
  config: { token: string; concurrency: number }
): Promise<void> {
  const client = new OcrClient(config.token);
  const queue = [...chunks];
  let failure: Error | null = null;

  const worker = async (): Promise<void> => {
    while (!failure) {
      ensureNotAborted(ctx);
      const chunk = queue.shift();
      if (!chunk) return;
      try {
        await runChunk(deps, ctx, client, chunk, total);
      } catch (error) {
        if (ctx.signal.aborted) return;
        failure ??= toError(error);
      }
    }
  };

  const workerCount = Math.min(config.concurrency, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  ensureNotAborted(ctx);
  if (failure) throw failure;
}

/** 跑一个块：提交、轮询、落页；块内进度实时上报。 */
async function runChunk(
  deps: LibraryOcrTaskDeps,
  ctx: TaskContext,
  client: OcrClient,
  chunk: PdfChunk,
  total: number
): Promise<void> {
  const resourceId = readResourceId(ctx.payload);
  let extractedMax = 0;
  const result = await client.run(
    chunk.filePath,
    extracted => {
      extractedMax = Math.max(extractedMax, extracted);
      const done = deps.pageRepo.countPages(resourceId);
      ctx.report(Math.min(done + extractedMax, total), total);
    },
    ctx.signal
  );

  ensureNotAborted(ctx);
  const pages = parsePaddleResult(result, chunk.start);
  await persistPages(deps, ctx, resourceId, pages);
  ctx.report(deps.pageRepo.countPages(resourceId), total);
}

/** 把一块的页写进库：先删同页再插，保证重跑幂等；插图失败只记日志。 */
async function persistPages(
  deps: LibraryOcrTaskDeps,
  ctx: TaskContext,
  resourceId: string,
  pages: readonly OcrPageResult[]
): Promise<void> {
  const createdAttachments: string[] = [];
  const rows: ResourceOcrPage[] = [];

  for (const page of pages) {
    const images: Array<{ bbox: OcrImage['bbox']; attachmentId: string }> = [];
    for (const image of page.images) {
      ensureNotAborted(ctx);
      try {
        const attachmentId = await storeImage(deps, ctx, image);
        createdAttachments.push(attachmentId);
        images.push({ bbox: image.bbox, attachmentId });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        log.warn(`[OCR] 插图保存失败，跳过：${image.name}`, error);
      }
    }
    rows.push({ page: page.page, blocks: mergePageBlocks(page.blocks, images) });
  }

  try {
    deps.transaction(() => {
      deps.pageRepo.deletePages(
        resourceId,
        rows.map(row => row.page)
      );
      deps.pageRepo.insertMany(resourceId, rows);
    });
  } catch (error) {
    await deps.attachmentService.deleteAttachments(createdAttachments);
    throw error;
  }
}

/** 下载一张插图并登记为附件；原样保存，不压缩。 */
async function storeImage(
  deps: LibraryOcrTaskDeps,
  ctx: TaskContext,
  image: OcrImage
): Promise<string> {
  const response = await fetch(image.url, {
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) {
    throw new Error(`插图下载失败：HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const stored = await deps.attachmentService.storeImageOriginal(
    bytes,
    response.headers.get('content-type') ?? 'image/png'
  );
  return stored.attachmentId;
}

/** 全部页落库后重新分片；分片失败算任务失败，重试会跳过已识别页。 */
async function replaceChunks(deps: LibraryOcrTaskDeps, resourceId: string): Promise<void> {
  const pages = deps.pageRepo.listPages(resourceId);
  if (pages.length === 0) return;

  const report: PdfTextReport = {
    pageCount: pages.length,
    pages: pages.map(page => ({ page: page.page, text: ocrBlocksToText(page.blocks) })),
  };

  try {
    const drafts = await chunkResource(createPdfSource(report));
    deps.chunkRepo.replaceForResource(resourceId, drafts);
  } catch (error) {
    throw new TaskFailure('FAILED', `文字提取完成，但分片失败：${toError(error).message}`, true);
  }
}

/** 读缓存元数据；没有时现场计算并写回。 */
async function ensureDocMeta(
  deps: LibraryOcrTaskDeps,
  resourceId: string,
  filePath: string
): Promise<PdfDocMeta> {
  const cached = parsePdfDocMeta(deps.resourceRepo.findDocMeta(resourceId));
  if (cached) return cached;

  return patchPdfDocMeta(deps.resourceRepo, resourceId, await readPdfInfo(filePath));
}

/** 块里的每一页都已经有结果时，这一块就跳过。 */
function isChunkDone(chunk: PdfChunk, existing: Set<number>): boolean {
  for (let page = chunk.start; page <= chunk.end; page += 1) {
    if (!existing.has(page)) return false;
  }
  return true;
}

/** 读分块与并发配置；越界值夹到安全区间。 */
function readOcrConfig(config: OcrConfig): {
  pageSize: number;
  concurrency: number;
  token: string | null;
} {
  const ocr = config.get();
  return {
    pageSize: clamp(ocr?.pageSize ?? DEFAULT_PAGE_SIZE, 1, 500),
    concurrency: clamp(ocr?.concurrency ?? DEFAULT_CONCURRENCY, 1, 8),
    token: ocr?.['paddle-ocr']?.token?.trim() || null,
  };
}

/** 任务 payload 里只接受 resourceId。 */
function readResourceId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('resourceId' in payload)) {
    throw new TaskFailure('FAILED', '任务参数缺少 resourceId', false);
  }
  const { resourceId } = payload as { resourceId: unknown };
  if (typeof resourceId !== 'string') {
    throw new TaskFailure('FAILED', '任务参数里的 resourceId 不合法', false);
  }
  return resourceId;
}

function ensureNotAborted(ctx: TaskContext): void {
  if (ctx.signal.aborted) throw new Error('任务已中止');
}

/** 把任意异常收敛成任务失败；只有可重试的 OCR 错误标记为可重试。 */
function toTaskFailure(error: unknown): TaskFailure {
  if (error instanceof TaskFailure) return error;
  const message = toError(error).message;
  if (isRetryableOcrError(error)) return new TaskFailure('NETWORK', message, true);
  return new TaskFailure('FAILED', message, false);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
