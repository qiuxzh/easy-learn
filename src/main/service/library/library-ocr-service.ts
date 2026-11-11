import path from 'node:path';
import { DomainError } from '@main/domain-error';
import type { Paths } from '@main/paths';
import type { TransactionRunner } from '@main/contracts/transaction';
import type { ResourceEntity } from '@main/contracts/resource';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { ResourceChunkRepo, ResourceOcrPageRepo } from '@main/contracts/resource-ocr-repo';
import type { ResourceOcrStartResult, ResourceOcrState } from '@main/contracts/resource-ocr';
import type { TaskEntity } from '@main/contracts/task';
import type { TaskScheduler } from '@main/service/task/task-scheduler';
import { readPdfInfo, type PdfInfo } from '@main/service/etl/pdf/inspect';
import type { PdfDocMeta } from '@shared/types/library';
import { parsePdfDocMeta, patchPdfDocMeta } from './doc-meta';

/** OCR 任务类型；与 `createLibraryOcrTask` 注册的 key 保持一致。 */
export const LIBRARY_OCR_TASK_TYPE = 'ocr-pdf';

export interface LibraryOcrServiceDeps {
  paths: Paths;
  transaction: TransactionRunner;
  resourceRepo: ResourceRepo;
  pageRepo: ResourceOcrPageRepo;
  chunkRepo: ResourceChunkRepo;
  /** 任务编排器。 */
  taskService: TaskScheduler;
  /** 读取 PDF 元数据；测试可替换。 */
  inspect?: (filePath: string) => Promise<PdfInfo>;
}

/**
 * 资料 OCR 的用例层：检查是否适用、启动识别、给界面提供状态。
 *
 * 不直接跑识别：真正的执行在 `ocr-pdf` 任务里，进度与暂停/取消由任务系统负责。
 */
export class LibraryOcrService {
  private readonly paths: Paths;
  private readonly transaction: TransactionRunner;
  private readonly resourceRepo: ResourceRepo;
  private readonly pageRepo: ResourceOcrPageRepo;
  private readonly chunkRepo: ResourceChunkRepo;
  private readonly taskService: TaskScheduler;
  private readonly inspect: (filePath: string) => Promise<PdfInfo>;
  /** 正在启动的资源 id；挡住两次 IPC 同时入队。 */
  private readonly starting = new Set<string>();

  constructor(deps: LibraryOcrServiceDeps) {
    this.paths = deps.paths;
    this.transaction = deps.transaction;
    this.resourceRepo = deps.resourceRepo;
    this.pageRepo = deps.pageRepo;
    this.chunkRepo = deps.chunkRepo;
    this.taskService = deps.taskService;
    this.inspect = deps.inspect ?? readPdfInfo;
  }

  /**
   * 读取一个资料的识别状态。
   *
   * 非 PDF 直接返回「不适用」，不解析文件；PDF 首次调用会读取文本层并缓存。
   * PDF 不论有没有文本层都可以识别，`hasTextLayer` 只作为属性展示。
   *
   * @throws 文件缺失、加密或损坏时抛 {@link DomainError}
   */
  async getState(resourceId: string): Promise<ResourceOcrState> {
    const resource = this.resourceRepo.findById(resourceId);

    if (!resource || resource.kind !== 'file' || resource.format !== 'pdf') {
      return this.buildState(resource, null);
    }

    const meta = await this.ensureDocMeta(resource);
    return this.buildState(resource, meta);
  }

  /**
   * 批量读取识别状态，供列表展示。
   *
   * 只读 `doc_meta` 的缓存，不解析 PDF：没有缓存时页数和文本层返回 null，
   * 等抽屉打开 `getState` 时再算。
   *
   * @param resourceIds 要查询的资料 id
   */
  async getStates(resourceIds: readonly string[]): Promise<Record<string, ResourceOcrState>> {
    const result: Record<string, ResourceOcrState> = {};

    for (const resourceId of new Set(resourceIds)) {
      const resource = this.resourceRepo.findById(resourceId);
      const meta =
        resource && resource.kind === 'file' && resource.format === 'pdf'
          ? parsePdfDocMeta(this.resourceRepo.findDocMeta(resourceId))
          : null;
      result[resourceId] = this.buildState(resource, meta);
    }

    return result;
  }

  /**
   * 启动识别。
   *
   * `restart` 会先清掉旧页块与分片；否则已识别的页会被任务跳过。
   *
   * @throws 资料不存在、不是 PDF 或已有识别任务
   */
  async start(
    resourceId: string,
    options: { restart?: boolean } = {}
  ): Promise<ResourceOcrStartResult> {
    this.requirePdf(resourceId);
    // 单飞只覆盖排队/运行/暂停；失败行不在活跃集合里，它被 retry 时可能与新任务并行。
    if (this.starting.has(resourceId) || this.findActiveTask(resourceId)) {
      throw new DomainError('该资料已有识别任务在运行');
    }

    this.starting.add(resourceId);
    try {
      if (options.restart) {
        this.transaction(() => {
          this.pageRepo.deletePages(resourceId);
          this.chunkRepo.deleteForResource(resourceId);
        });
      }

      const task = this.taskService.enqueue({
        taskType: LIBRARY_OCR_TASK_TYPE,
        payload: { resourceId },
      });
      return { taskId: task.id };
    } finally {
      this.starting.delete(resourceId);
    }
  }

  /** 确保缓存里有 PDF 元数据；没有时读取并局部写回，保留已有 toc。 */
  private async ensureDocMeta(resource: ResourceEntity): Promise<PdfDocMeta> {
    const cached = parsePdfDocMeta(this.resourceRepo.findDocMeta(resource.id));
    if (cached) return cached;
    if (!resource.blobPath) throw new DomainError('资料文件不存在');

    try {
      const info = await this.inspect(path.join(this.paths.dataDir, resource.blobPath));
      return patchPdfDocMeta(this.resourceRepo, resource.id, info);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DomainError(`无法读取 PDF：${message}`);
    }
  }

  /** 把资源与元数据拼成界面要的状态。 */
  private buildState(
    resource: ResourceEntity | undefined,
    meta: PdfDocMeta | null
  ): ResourceOcrState {
    const isPdf = !!resource && resource.kind === 'file' && resource.format === 'pdf';
    return {
      applicable: isPdf,
      hasTextLayer: isPdf ? (meta?.hasTextLayer ?? null) : null,
      pageCount: isPdf ? (meta?.pageCount ?? null) : null,
      donePages: resource?.kind === 'file' ? this.pageRepo.countPages(resource.id) : 0,
      chunkCount: resource?.kind === 'file' ? this.chunkRepo.count(resource.id) : 0,
    };
  }

  /** 校验并返回 PDF 资料；其它格式直接拒绝。 */
  private requirePdf(resourceId: string): ResourceEntity {
    const resource = this.resourceRepo.findById(resourceId);
    if (!resource || resource.kind !== 'file' || resource.format !== 'pdf') {
      throw new DomainError('该资料不是 PDF 文件');
    }
    return resource;
  }

  /**
   * 找这个资料当前的识别任务；终态任务不算。
   *
   * 失败行是终态，因此不计入占用：同一资源可能被「新任务 + 旧失败任务重试」
   * 同时处理，`start` 的单飞挡不住这种情况。
   */
  private findActiveTask(resourceId: string): TaskEntity | undefined {
    return this.taskService
      .listByType(LIBRARY_OCR_TASK_TYPE)
      .find(task => isActive(task) && readPayloadResourceId(task.payload) === resourceId);
  }
}

function isActive(task: TaskEntity): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'paused';
}

function readPayloadResourceId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('resourceId' in payload)) return null;
  const { resourceId } = payload as { resourceId: unknown };
  return typeof resourceId === 'string' ? resourceId : null;
}
