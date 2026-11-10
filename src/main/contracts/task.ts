import type { TaskError, TaskErrorCode, TaskProgress, TaskStatus } from '@shared/types/task';

/** 任务队列中的一条记录；`completed` 与 `cancelled` 不会以这个形状存在。 */
export interface TaskEntity {
  /** 任务 id，创建时生成。 */
  id: string;
  /** 处理器注册表的 key。 */
  taskType: string;
  status: TaskStatus;
  /** 最近一次落库的进度快照；仅用于展示，不参与恢复。 */
  progress: TaskProgress | null;
  /** 处理器专属入参。 */
  payload: unknown;
  /** 仅 `failed` 时有值。 */
  error: TaskError | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  failedAt: number | null;
}

/** 入队参数；并发上限由 taskType 的注册表给出，调用方不填。 */
export interface TaskCreate {
  taskType: string;
  payload: unknown;
}

/** handler 执行时拿到的上下文。 */
export interface TaskContext {
  taskId: string;
  payload: unknown;
  /** 暂停、取消或超时时触发；handler 必须在单元边界检查。 */
  signal: AbortSignal;
  /** 任务专属临时目录，由调度器按任务行生命周期创建与删除。 */
  workspaceDir: string;
  /** 上报进度；调度器负责节流落库，比例由 finished / total 得出。 */
  report(finished: number, total: number): void;
}

/** 任务类型注册项；处理器只写业务，不感知队列与持久化。 */
export interface TaskDefinition {
  taskType: string;
  /** 该任务类型同时允许执行的数量；每个类型各自限流。 */
  maxConcurrency: number;
  /** 暂停后能否续跑；false 时调度器拒绝暂停。 */
  pausable?: boolean;
  /** 单次执行的总超时；省略时用调度器默认值。 */
  timeoutMs?: number;
  run(ctx: TaskContext): Promise<void>;
}

/** 业务侧主动失败时抛出，调度器据此保留错误码与可重试标记。 */
export class TaskFailure extends Error {
  readonly code: TaskErrorCode;
  readonly retryable: boolean;

  constructor(code: TaskErrorCode, message: string, retryable = true) {
    super(message);
    this.name = 'TaskFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

/** 调度器对外事件；进度事件已节流，状态事件带完整实体。 */
export type TaskEvent =
  | { type: 'created'; task: TaskEntity }
  | { type: 'updated'; task: TaskEntity }
  | {
      type: 'progress';
      taskId: string;
      progress: TaskProgress;
      finished: number;
      total: number;
    }
  | {
      type: 'settled';
      taskId: string;
      status: 'completed' | 'cancelled' | 'failed';
      error?: TaskError;
    };

/** 生命周期操作被拒绝的原因；调用方据此决定提示文案。 */
export type { TaskOpFailureReason, TaskOpResult } from '@shared/types/task';
