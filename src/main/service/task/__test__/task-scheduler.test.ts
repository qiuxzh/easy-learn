import { afterEach, describe, expect, it } from 'vitest';
import { TaskScheduler } from '../task-scheduler';
import type { TaskContext, TaskDefinition, TaskEntity } from '@main/contracts/task';
import type { TaskRepo } from '@main/contracts/task-repo';
import type { TaskError, TaskProgress } from '@shared/types/task';
import type { TaskWorkspace } from '../task-workspace';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** 轮询等待断言条件成立；超时直接失败，避免用例挂死。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await sleep(5);
  }
}

class FakeTaskRepo implements TaskRepo {
  private readonly tasks = new Map<string, TaskEntity>();
  private sequence = 0;

  create(data: { taskType: string; payload: unknown }): TaskEntity {
    const now = Date.now();
    const task: TaskEntity = {
      id: `task-${++this.sequence}`,
      taskType: data.taskType,
      status: 'queued',
      progress: null,
      payload: data.payload,
      error: null,
      createdAt: now + this.sequence,
      updatedAt: now,
      startedAt: null,
      failedAt: null,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  findById(id: string): TaskEntity | undefined {
    return this.tasks.get(id);
  }

  list(): TaskEntity[] {
    return [...this.tasks.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  listQueued(): TaskEntity[] {
    return this.list().filter(task => task.status === 'queued');
  }

  recoverRunning(): number {
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== 'running') continue;
      task.status = 'queued';
      recovered += 1;
    }
    return recovered;
  }

  claimNext(taskType: string): TaskEntity | undefined {
    const task = this.list().find(item => item.taskType === taskType && item.status === 'queued');
    if (!task) return undefined;
    task.status = 'running';
    task.startedAt = Date.now();
    task.updatedAt = Date.now();
    return task;
  }

  updateProgress(id: string, progress: TaskProgress): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.progress = progress;
    task.updatedAt = Date.now();
  }

  markPaused(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'paused';
    task.updatedAt = Date.now();
  }

  markQueued(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'queued';
    task.updatedAt = Date.now();
  }

  fail(id: string, error: TaskError): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'failed';
    task.error = error;
    task.failedAt = Date.now();
    task.updatedAt = Date.now();
  }

  remove(id: string): void {
    this.tasks.delete(id);
  }

  requeue(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'failed') return;
    task.status = 'queued';
    task.error = null;
    task.failedAt = null;
    task.updatedAt = Date.now();
  }

  /** 直接写入一条记录，用于构造崩溃恢复、失败重试等前置状态。 */
  seed(task: Partial<TaskEntity> & Pick<TaskEntity, 'id' | 'taskType'>): TaskEntity {
    const now = Date.now();
    const entity: TaskEntity = {
      status: 'queued',
      progress: null,
      payload: {},
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      failedAt: null,
      ...task,
    };
    this.tasks.set(entity.id, entity);
    return entity;
  }
}

type FakeWorkspace = TaskWorkspace & { dirs: Set<string> };

function createFakeWorkspace(): FakeWorkspace {
  const dirs = new Set<string>();
  return {
    dirs,
    pathFor: id => `/workspace/${id}`,
    create: id => {
      dirs.add(id);
      return `/workspace/${id}`;
    },
    remove: id => {
      dirs.delete(id);
    },
    sweep: known => {
      for (const id of [...dirs]) {
        if (!known.has(id)) dirs.delete(id);
      }
    },
  };
}

function createTestScheduler(
  options: {
    run?: TaskDefinition['run'];
    resume?: TaskDefinition['resume'];
    timeoutMs?: number;
    maxConcurrency?: number;
  } = {}
) {
  const repo = new FakeTaskRepo();
  const workspace = createFakeWorkspace();
  const definition: TaskDefinition = {
    taskType: 'demo',
    maxConcurrency: options.maxConcurrency ?? 2,
    resume: options.resume ?? 'skip',
    timeoutMs: options.timeoutMs ?? 5_000,
    run: options.run ?? (async () => {}),
  };
  const scheduler = new TaskScheduler({
    taskRepo: repo,
    definitions: [definition],
    workspace,
    tickMs: 5,
    progressFlushMs: 0,
    abortGraceMs: 30,
    defaultTimeoutMs: 5_000,
  });
  activeScheduler = scheduler;
  return { scheduler, repo, workspace };
}

let activeScheduler: TaskScheduler | null = null;

afterEach(async () => {
  await activeScheduler?.shutdown(10);
  activeScheduler = null;
});

describe('TaskScheduler 派发', () => {
  it('按任务类型并发上限派发，完成后再领下一个', async () => {
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const { scheduler } = createTestScheduler({
      maxConcurrency: 1,
      run: async ctx => {
        started.push((ctx.payload as { index: number }).index);
        await new Promise<void>(resolve => releases.push(resolve));
      },
    });
    scheduler.start();
    scheduler.enqueue({ taskType: 'demo', payload: { index: 0 } });
    scheduler.enqueue({ taskType: 'demo', payload: { index: 1 } });

    await waitFor(() => started.length === 1);
    expect(started).toEqual([0]);

    releases.shift()!();
    await waitFor(() => started.length === 2);
    expect(started).toEqual([0, 1]);
    while (releases.length > 0) releases.shift()!();
    await waitFor(() => scheduler.list().length === 0);
  });

  it('同一任务类型重复注册时构造报错', () => {
    const repo = new FakeTaskRepo();
    const workspace = createFakeWorkspace();
    expect(
      () =>
        new TaskScheduler({
          taskRepo: repo,
          definitions: [
            { taskType: 'demo', maxConcurrency: 1, resume: 'skip', run: async () => {} },
            { taskType: 'demo', maxConcurrency: 2, resume: 'skip', run: async () => {} },
          ],
          workspace,
        })
    ).toThrow('重复注册');
  });

  it('未注册的任务类型入队时抛出领域错误', () => {
    const { scheduler } = createTestScheduler();
    expect(() => scheduler.enqueue({ taskType: 'unknown', payload: {} })).toThrow(
      '未注册的任务类型'
    );
  });

  it('事件顺序是 created、updated、settled', async () => {
    const events: string[] = [];
    const { scheduler } = createTestScheduler();
    scheduler.subscribe(event => events.push(event.type));
    scheduler.start();
    scheduler.enqueue({ taskType: 'demo', payload: {} });
    await waitFor(() => events.includes('settled'));
    expect(events).toEqual(['created', 'updated', 'settled']);
  });
});

describe('TaskScheduler 暂停与恢复', () => {
  it('排队中的任务可以暂停与恢复', async () => {
    const { scheduler, repo } = createTestScheduler();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });

    expect(await scheduler.pause(task.id)).toEqual({ ok: true });
    expect(repo.findById(task.id)?.status).toBe('paused');

    expect(await scheduler.resume(task.id)).toEqual({ ok: true });
    expect(repo.findById(task.id)?.status).toBe('queued');
  });

  it('暂停运行中的任务会停住并保留进度', async () => {
    const { scheduler, repo } = createTestScheduler({
      run: async ctx => {
        for (let index = 0; index < 100; index += 1) {
          if (ctx.signal.aborted) throw new Error('aborted');
          await sleep(5);
          ctx.report(index + 1, 100);
        }
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });

    await waitFor(() => (repo.findById(task.id)?.progress?.ratio ?? 0) > 0);
    expect(await scheduler.pause(task.id)).toEqual({ ok: true });

    const paused = repo.findById(task.id);
    expect(paused?.status).toBe('paused');
    expect(paused?.progress).not.toBeNull();
  });

  it('暂停时 handler 不响应 abort 会落 ABORT_TIMEOUT', async () => {
    const { scheduler, repo } = createTestScheduler({
      run: async () => {
        await sleep(120);
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    await waitFor(() => repo.findById(task.id)?.status === 'running');

    expect(await scheduler.pause(task.id)).toEqual({ ok: false, reason: 'abort_timeout' });
    expect(repo.findById(task.id)?.status).toBe('failed');
    expect(repo.findById(task.id)?.error?.code).toBe('ABORT_TIMEOUT');
  });

  it('声明 resume 为 none 的任务拒绝暂停', async () => {
    const { scheduler } = createTestScheduler({
      resume: 'none',
      run: async () => {
        await sleep(100);
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    await waitFor(() =>
      scheduler.list().some(item => item.id === task.id && item.status === 'running')
    );

    expect(await scheduler.pause(task.id)).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('TaskScheduler 取消与重试', () => {
  it('取消排队任务会删行并删临时目录', async () => {
    const { scheduler, repo, workspace } = createTestScheduler();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    expect(workspace.dirs.has(task.id)).toBe(true);

    expect(await scheduler.cancel(task.id)).toEqual({ ok: true });
    expect(repo.findById(task.id)).toBeUndefined();
    expect(workspace.dirs.has(task.id)).toBe(false);
  });

  it('取消运行中的任务会停住并删行', async () => {
    const { scheduler, repo } = createTestScheduler({
      run: async ctx => {
        while (!ctx.signal.aborted) await sleep(5);
        throw new Error('aborted');
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    await waitFor(() => repo.findById(task.id)?.status === 'running');

    expect(await scheduler.cancel(task.id)).toEqual({ ok: true });
    expect(repo.findById(task.id)).toBeUndefined();
  });

  it('失败任务重试保留进度并回到队列', async () => {
    const { scheduler, repo } = createTestScheduler();
    repo.seed({
      id: 'failed-1',
      taskType: 'demo',
      status: 'failed',
      progress: { kind: 'ratio', ratio: 0.5 },
      error: { code: 'FAILED', message: '网络错误', retryable: true },
    });

    expect(await scheduler.retry('failed-1')).toEqual({ ok: true });
    expect(repo.findById('failed-1')?.status).toBe('queued');
    expect(repo.findById('failed-1')?.progress).toEqual({ kind: 'ratio', ratio: 0.5 });
    expect(repo.findById('failed-1')?.error).toBeNull();
  });

  it('非失败任务重试会被拒绝', async () => {
    const { scheduler, repo } = createTestScheduler();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    expect(await scheduler.retry(task.id)).toEqual({ ok: false, reason: 'wrong_status' });
    expect(repo.findById(task.id)?.status).toBe('queued');
  });

  it('忽略失败任务会删行与临时目录', async () => {
    const { scheduler, repo, workspace } = createTestScheduler();
    repo.seed({ id: 'failed-2', taskType: 'demo', status: 'failed' });
    workspace.create('failed-2');

    expect(await scheduler.dismiss('failed-2')).toEqual({ ok: true });
    expect(repo.findById('failed-2')).toBeUndefined();
    expect(workspace.dirs.has('failed-2')).toBe(false);
  });
});

describe('TaskScheduler 恢复与超时', () => {
  it('启动时把中断任务改回队列并重新派发', async () => {
    const runs: string[] = [];
    const { scheduler, repo } = createTestScheduler({
      run: async (ctx: TaskContext) => {
        runs.push(ctx.taskId);
      },
    });
    repo.seed({ id: 'crashed-1', taskType: 'demo', status: 'running' });

    scheduler.start();
    await waitFor(() => runs.includes('crashed-1'));
    expect(repo.findById('crashed-1')).toBeUndefined();
  });

  it('历史任务没有处理器时落 NO_HANDLER', async () => {
    const { scheduler, repo } = createTestScheduler();
    repo.seed({ id: 'old-1', taskType: 'removed', status: 'queued' });

    scheduler.start();
    expect(repo.findById('old-1')?.status).toBe('failed');
    expect(repo.findById('old-1')?.error?.code).toBe('NO_HANDLER');
  });

  it('退出时最多等一个预算，没停稳的任务保持 running', async () => {
    const { scheduler, repo } = createTestScheduler({
      run: async () => {
        await sleep(120);
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });
    await waitFor(() => repo.findById(task.id)?.status === 'running');

    const startedAt = Date.now();
    await scheduler.shutdown(30);

    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(repo.findById(task.id)?.status).toBe('running');
  });

  it('总超时后 abort 并落 TIMEOUT', async () => {
    const { scheduler, repo } = createTestScheduler({
      timeoutMs: 20,
      run: async () => {
        await sleep(200);
      },
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });

    await waitFor(() => repo.findById(task.id)?.status === 'failed');
    expect(repo.findById(task.id)?.error?.code).toBe('TIMEOUT');
  });

  it('超时后 handler 立即响应 abort 也落 TIMEOUT', async () => {
    const { scheduler, repo } = createTestScheduler({
      timeoutMs: 20,
      run: ctx =>
        new Promise<void>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    scheduler.start();
    const task = scheduler.enqueue({ taskType: 'demo', payload: {} });

    await waitFor(() => repo.findById(task.id)?.status === 'failed');
    expect(repo.findById(task.id)?.error?.code).toBe('TIMEOUT');
  });
});
