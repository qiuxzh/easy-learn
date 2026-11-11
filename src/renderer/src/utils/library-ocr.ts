import type { ResourceOcrStateDTO } from '@shared/types/ocr';
import type { TaskOpFailureReason, TaskSnapshot } from '@shared/types/task';

/** OCR 任务 payload 的最小形状。 */
export interface OcrTaskPayload {
  resourceId: string;
  name?: string;
}

/** 从任意 task payload 里取 resourceId。 */
export function readOcrResourceId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('resourceId' in payload)) return null;
  const { resourceId } = payload as { resourceId: unknown };
  return typeof resourceId === 'string' ? resourceId : null;
}

function isActive(task: TaskSnapshot): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'paused';
}

/** 同资源多条任务时，活跃任务优先，其次取创建时间较新的失败任务。 */
function preferTask(candidate: TaskSnapshot, current: TaskSnapshot): boolean {
  if (isActive(candidate) && !isActive(current)) return true;
  if (!isActive(candidate) && isActive(current)) return false;
  return candidate.createdAt > current.createdAt;
}

/** 按 resourceId 收集 OCR 任务，同一资源只保留一条。 */
export function collectOcrTasks(tasks: readonly TaskSnapshot[]): Map<string, TaskSnapshot> {
  const map = new Map<string, TaskSnapshot>();

  for (const task of tasks) {
    if (task.taskType !== 'ocr-pdf') continue;
    const resourceId = readOcrResourceId(task.payload);
    if (!resourceId) continue;
    const current = map.get(resourceId);
    if (!current || preferTask(task, current)) map.set(resourceId, task);
  }

  return map;
}

/** 找某个资源要展示的 OCR 任务。 */
export function findOcrTask(
  tasks: readonly TaskSnapshot[],
  resourceId: string
): TaskSnapshot | undefined {
  let active: TaskSnapshot | undefined;
  let failed: TaskSnapshot | undefined;

  for (const task of tasks) {
    if (task.taskType !== 'ocr-pdf') continue;
    if (readOcrResourceId(task.payload) !== resourceId) continue;

    if (isActive(task)) {
      if (!active || task.createdAt > active.createdAt) active = task;
    } else if (task.status === 'failed') {
      if (!failed || task.createdAt > failed.createdAt) failed = task;
    }
  }

  return active ?? failed;
}

export type LibraryOcrStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'paused'
  | 'failed'
  | 'partial'
  | 'completed';

export interface OcrProgress {
  finished: number;
  total: number;
  ratio: number;
}

/** 任务优先；没有任务时根据已落库页数和分片判断进度。 */
export function resolveOcrStatus(
  task: TaskSnapshot | undefined,
  state: ResourceOcrStateDTO | undefined
): LibraryOcrStatus {
  if (task) return task.status;

  if (state && state.donePages > 0) {
    const pagesDone =
      state.pageCount !== null && state.pageCount > 0 && state.donePages >= state.pageCount;
    if (pagesDone && state.chunkCount > 0) return 'completed';
    return 'partial';
  }

  return 'idle';
}

/** 进度优先取任务快照，没有任务时退回域表的已识别页数。 */
export function resolveOcrProgress(
  task: TaskSnapshot | undefined,
  state: ResourceOcrStateDTO | undefined
): OcrProgress | null {
  if (task?.progress && task.progress.total > 0) {
    return {
      finished: task.progress.finished,
      total: task.progress.total,
      ratio: Math.min(task.progress.finished / task.progress.total, 1),
    };
  }

  if (state?.pageCount && state.pageCount > 0) {
    return {
      finished: state.donePages,
      total: state.pageCount,
      ratio: Math.min(state.donePages / state.pageCount, 1),
    };
  }

  return null;
}

/** 状态文案；running / paused 带百分比，partial 带已识别页数。 */
export function ocrStatusLabel(status: LibraryOcrStatus, progress: OcrProgress | null): string {
  const percent = progress ? Math.round(progress.ratio * 100) : 0;

  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return `识别中 ${percent}%`;
    case 'paused':
      return `已暂停 ${percent}%`;
    case 'failed':
      return '识别失败';
    case 'partial':
      if (progress && progress.finished >= progress.total) return '待分片';
      return progress ? `已识别 ${progress.finished}/${progress.total} 页` : '未完成';
    case 'completed':
      return '已识别';
    case 'idle':
      return '未识别';
  }
}

/** 状态对应的徽标语义色。 */
export function ocrStatusTone(
  status: LibraryOcrStatus
): 'default' | 'info' | 'warn' | 'success' | 'danger' {
  switch (status) {
    case 'running':
      return 'info';
    case 'paused':
      return 'warn';
    case 'failed':
      return 'danger';
    case 'partial':
      return 'warn';
    case 'completed':
      return 'success';
    case 'queued':
      return 'info';
    case 'idle':
      return 'default';
  }
}

const TASK_OP_FAILURE_TEXT: Record<TaskOpFailureReason, string> = {
  not_found: '任务已结束',
  wrong_status: '任务状态已变化，请刷新后重试',
  still_running: '上一轮执行还没停止，请稍后再试',
  unsupported: '该任务不支持这个操作',
  abort_timeout: '任务未能及时停止',
};

/** 任务操作被拒绝时的提示文案。 */
export function describeOcrTaskFailure(reason: TaskOpFailureReason): string {
  return TASK_OP_FAILURE_TEXT[reason];
}
