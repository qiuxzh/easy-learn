import { and, asc, eq } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import type { TaskRepo as TaskRepoContract } from '@main/contracts/task-repo';
import type { TaskCreate, TaskEntity } from '@main/contracts/task';
import type { TaskError, TaskProgress } from '@shared/types/task';
import { taskTable } from '@main/infra/db/schema';
import type { TaskRow } from '@main/infra/db/schema';

class TaskRepo {
  constructor(private readonly handle: DbHandle) {}

  create(data: TaskCreate): TaskEntity {
    const now = Date.now();
    const row = this.handle.db
      .insert(taskTable)
      .values({
        id: crypto.randomUUID(),
        taskType: data.taskType,
        status: 'queued',
        progress: null,
        payload: JSON.stringify(data.payload),
        error: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        failedAt: null,
      })
      .returning()
      .get();
    return toTaskEntity(row);
  }

  findById(id: string): TaskEntity | undefined {
    const row = this.handle.db.select().from(taskTable).where(eq(taskTable.id, id)).get();
    return row ? toTaskEntity(row) : undefined;
  }

  list(): TaskEntity[] {
    return this.handle.db
      .select()
      .from(taskTable)
      .orderBy(asc(taskTable.createdAt))
      .all()
      .map(toTaskEntity);
  }

  listQueued(): TaskEntity[] {
    return this.handle.db
      .select()
      .from(taskTable)
      .where(eq(taskTable.status, 'queued'))
      .orderBy(asc(taskTable.createdAt))
      .all()
      .map(toTaskEntity);
  }

  recoverRunning(): number {
    const now = Date.now();
    const rows = this.handle.db
      .update(taskTable)
      .set({ status: 'queued', updatedAt: now })
      .where(eq(taskTable.status, 'running'))
      .returning({ id: taskTable.id })
      .all();
    return rows.length;
  }

  /**
   * 领取某任务类型的队首。
   *
   * 先查再改是两条语句，但调度器在单线程主进程里串行调用，不存在竞争；
   * `AND status = 'queued'` 是防御，避免同一行被改两次。
   */
  claimNext(taskType: string): TaskEntity | undefined {
    const head = this.handle.db
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(and(eq(taskTable.taskType, taskType), eq(taskTable.status, 'queued')))
      .orderBy(asc(taskTable.createdAt))
      .limit(1)
      .get();
    if (!head) return undefined;

    const now = Date.now();
    const row = this.handle.db
      .update(taskTable)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(taskTable.id, head.id), eq(taskTable.status, 'queued')))
      .returning()
      .get();
    return row ? toTaskEntity(row) : undefined;
  }

  updateProgress(id: string, progress: TaskProgress): void {
    this.handle.db
      .update(taskTable)
      .set({ progress: JSON.stringify(progress), updatedAt: Date.now() })
      .where(eq(taskTable.id, id))
      .run();
  }

  markPaused(id: string): void {
    this.handle.db
      .update(taskTable)
      .set({ status: 'paused', updatedAt: Date.now() })
      .where(eq(taskTable.id, id))
      .run();
  }

  markQueued(id: string): void {
    this.handle.db
      .update(taskTable)
      .set({ status: 'queued', updatedAt: Date.now() })
      .where(eq(taskTable.id, id))
      .run();
  }

  fail(id: string, error: TaskError): void {
    const now = Date.now();
    this.handle.db
      .update(taskTable)
      .set({ status: 'failed', error: JSON.stringify(error), failedAt: now, updatedAt: now })
      .where(eq(taskTable.id, id))
      .run();
  }

  remove(id: string): void {
    this.handle.db.delete(taskTable).where(eq(taskTable.id, id)).run();
  }

  requeue(id: string): void {
    this.handle.db
      .update(taskTable)
      .set({
        status: 'queued',
        error: null,
        startedAt: null,
        failedAt: null,
        updatedAt: Date.now(),
      })
      .where(and(eq(taskTable.id, id), eq(taskTable.status, 'failed')))
      .run();
  }
}

function toTaskEntity(row: TaskRow): TaskEntity {
  return {
    id: row.id,
    taskType: row.taskType,
    status: row.status,
    progress: row.progress ? (JSON.parse(row.progress) as TaskProgress) : null,
    payload: JSON.parse(row.payload),
    error: row.error ? (JSON.parse(row.error) as TaskError) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    failedAt: row.failedAt,
  };
}

/** 实现类不导出，调用方只依赖 contracts 里的接口。 */
export function createTaskRepo(handle: DbHandle): TaskRepoContract {
  return new TaskRepo(handle);
}
