import { describe, expect, it, vi } from 'vitest';
import type { ResourceEntity } from '@main/contracts/resource';
import type { ResourceChunkDraft, ResourceOcrPage } from '@main/contracts/resource-ocr';
import type { PdfInfo } from '@main/service/etl/pdf/inspect';
import type { ResourceChunkRepo, ResourceOcrPageRepo } from '@main/contracts/resource-ocr-repo';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { TaskEntity } from '@main/contracts/task';
import type { Paths } from '@main/paths';
import type { TaskScheduler } from '@main/service/task/task-scheduler';
import { LibraryOcrService } from '../library-ocr-service';

const DATA_DIR = 'C:/app/data';

const paths: Paths = {
  dataDir: DATA_DIR,
  attachmentDir: `${DATA_DIR}/attachment`,
  booksDir: `${DATA_DIR}/books`,
  libraryDir: `${DATA_DIR}/library`,
  taskWorkDir: `${DATA_DIR}/task-work`,
  databasePath: `${DATA_DIR}/easy-learn.db`,
};

function createResource(overrides: Partial<ResourceEntity> = {}): ResourceEntity {
  return {
    id: 'r-1',
    parentId: null,
    kind: 'file',
    name: '论文.pdf',
    format: 'pdf',
    blobPath: 'library/r-1.pdf',
    sizeBytes: 1024,
    lastOpenedAt: null,
    starred: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: 'task-1',
    taskType: 'ocr-pdf',
    status: 'running',
    progress: { kind: 'ratio', finished: 4, total: 10 },
    payload: { resourceId: 'r-1' },
    error: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    failedAt: null,
    ...overrides,
  };
}

function createFakeResourceRepo(resource: ResourceEntity | undefined): ResourceRepo {
  return {
    create: vi.fn(),
    findById: vi.fn((id: string) => (resource?.id === id ? resource : undefined)),
    listChildren: vi.fn(() => []),
    countChildrenByParents: vi.fn(() => ({})),
    listStarredResources: vi.fn(() => []),
    sumFileSize: vi.fn(() => 0),
    findChildByName: vi.fn(() => undefined),
    updateName: vi.fn(),
    updateParent: vi.fn(),
    findDocMeta: vi.fn(() => null),
    setDocMeta: vi.fn(),
    setStarred: vi.fn(),
    deleteByIds: vi.fn(),
  } as unknown as ResourceRepo;
}

function createFakePageRepo(initial: number[] = []): ResourceOcrPageRepo & {
  pages: Set<number>;
  deletedAll: boolean;
} {
  const pages = new Set(initial);
  return {
    pages,
    deletedAll: false,
    listPageNumbers: () => [...pages],
    listPages: () => [],
    countPages: () => pages.size,
    deletePages: (_resourceId: string, target?: readonly number[]) => {
      if (!target) {
        pages.clear();
        return;
      }
      for (const page of target) pages.delete(page);
    },
    insertMany: (_resourceId: string, rows: readonly ResourceOcrPage[]) => {
      for (const row of rows) pages.add(row.page);
    },
  } as unknown as ResourceOcrPageRepo & { pages: Set<number>; deletedAll: boolean };
}

function createFakeChunkRepo(): ResourceChunkRepo & { deleted: boolean } {
  return {
    deleted: false,
    count: () => 0,
    deleteForResource: () => {},
    replaceForResource: (_id: string, drafts: readonly ResourceChunkDraft[]) => drafts.length,
  } as unknown as ResourceChunkRepo & { deleted: boolean };
}

function createFakeTaskService(tasks: TaskEntity[] = []): TaskScheduler & {
  enqueued: Array<{ taskType: string; payload: unknown }>;
  cancelled: string[];
} {
  const enqueued: Array<{ taskType: string; payload: unknown }> = [];
  const cancelled: string[] = [];
  const fake = {
    enqueued,
    cancelled,
    enqueue: vi.fn((input: { taskType: string; payload: unknown }) => {
      enqueued.push(input);
      return createTask({ id: 'task-new', status: 'queued', payload: input.payload });
    }),
    cancel: vi.fn(async (id: string) => {
      cancelled.push(id);
      return { ok: true as const };
    }),
    list: vi.fn(() => tasks),
    listByType: vi.fn((taskType: string) => tasks.filter(task => task.taskType === taskType)),
  };
  return fake as unknown as TaskScheduler & {
    enqueued: Array<{ taskType: string; payload: unknown }>;
    cancelled: string[];
  };
}

function createService(options: {
  resource?: ResourceEntity;
  tasks?: TaskEntity[];
  pages?: number[];
  inspect?: (filePath: string) => Promise<PdfInfo>;
}) {
  const resourceRepo = createFakeResourceRepo(options.resource ?? createResource());
  const pageRepo = createFakePageRepo(options.pages ?? []);
  const chunkRepo = createFakeChunkRepo();
  const taskService = createFakeTaskService(options.tasks ?? []);
  const inspect =
    options.inspect ??
    vi.fn(async (): Promise<PdfInfo> => ({ pageCount: 20, hasTextLayer: false }));

  const service = new LibraryOcrService({
    paths,
    transaction: fn => fn(),
    resourceRepo,
    pageRepo,
    chunkRepo,
    taskService,
    inspect,
  });

  return { service, resourceRepo, pageRepo, chunkRepo, taskService, inspect };
}

describe('LibraryOcrService 状态', () => {
  it('非 PDF 直接返回不适用，不读取文件', async () => {
    const { service, inspect } = createService({
      resource: createResource({ format: 'md', name: '笔记.md' }),
    });

    const state = await service.getState('r-1');

    expect(state.applicable).toBe(false);
    expect(state.hasTextLayer).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('首次读取 PDF 时计算元数据并写回 doc_meta', async () => {
    const { service, resourceRepo } = createService({});

    const state = await service.getState('r-1');

    expect(state).toMatchObject({
      applicable: true,
      hasTextLayer: false,
      pageCount: 20,
      donePages: 0,
      chunkCount: 0,
    });
    const written = vi.mocked(resourceRepo.setDocMeta).mock.calls[0]?.[1];
    expect(typeof written).toBe('string');
    expect(JSON.parse(written as string)).toMatchObject({
      format: 'pdf',
      pageCount: 20,
      hasTextLayer: false,
      toc: null,
    });
  });

  it('有文本层的 PDF 仍然适用识别', async () => {
    const { service } = createService({
      inspect: async () => ({ pageCount: 12, hasTextLayer: true }),
    });

    const state = await service.getState('r-1');

    expect(state.applicable).toBe(true);
    expect(state.hasTextLayer).toBe(true);
  });

  it('批量读取按资源返回，未缓存的页数留空', async () => {
    const { service } = createService({});

    const states = await service.getStates(['r-1', 'missing']);

    expect(states['r-1']).toMatchObject({ applicable: true, pageCount: null });
    expect(states.missing).toMatchObject({
      applicable: false,
      hasTextLayer: null,
      pageCount: null,
    });
  });
});

describe('LibraryOcrService 启动', () => {
  it('启动时按 resourceId 入队', async () => {
    const { service, taskService } = createService({});

    const result = await service.start('r-1');

    expect(result.taskId).toBe('task-new');
    expect(taskService.enqueued).toEqual([{ taskType: 'ocr-pdf', payload: { resourceId: 'r-1' } }]);
  });

  it('有文本层时仍可启动', async () => {
    const { service, taskService } = createService({
      inspect: async () => ({ pageCount: 12, hasTextLayer: true }),
    });

    const result = await service.start('r-1');

    expect(result.taskId).toBe('task-new');
    expect(taskService.enqueued).toHaveLength(1);
  });

  it('已有识别任务时拒绝重复启动', async () => {
    const { service } = createService({ tasks: [createTask()] });

    await expect(service.start('r-1')).rejects.toThrow('已有识别任务');
  });

  it('restart 会清掉旧页与分片', async () => {
    const { service, pageRepo } = createService({ pages: [1, 2, 3] });

    await service.start('r-1', { restart: true });

    expect(pageRepo.pages.size).toBe(0);
  });
});
