/**
 * 后台任务的持久状态。
 *
 * 完成与取消不落库：任务落终态时直接删除行，只通过事件通知调用方。
 */
export type TaskStatus = 'queued' | 'running' | 'paused' | 'failed';

/** 任务进度。首版只有比例，后续形态按 `kind` 扩展，旧行不需要迁移。 */
export type TaskProgress = { kind: 'ratio'; ratio: number };

/** 失败码的闭集；未覆盖的错误统一按 `FAILED` 记录。 */
export type TaskErrorCode =
  | 'FAILED'
  | 'TIMEOUT'
  | 'ABORT_TIMEOUT'
  | 'NO_HANDLER'
  | 'NO_RESOURCE'
  | 'NETWORK'
  | 'INVALID_TOKEN';

/** 失败信息；只有 `failed` 状态的行有值。 */
export interface TaskError {
  /** 稳定错误码，界面据此决定文案与是否提供重试。 */
  code: TaskErrorCode;
  /** 面向用户的说明。 */
  message: string;
  /** 是否值得用户手动重试。 */
  retryable: boolean;
}

/** 渲染层看到的任务快照；不带调度器内部状态。 */
export interface TaskSnapshot {
  id: string;
  taskType: string;
  status: TaskStatus;
  progress: TaskProgress | null;
  payload: unknown;
  error: TaskError | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  failedAt: number | null;
}

/** 按任务 id 操作时传递的入参。 */
export interface TaskIdInput {
  taskId: string;
}

/** 生命周期操作被拒绝的原因；调用方据此决定提示文案。 */
export type TaskOpFailureReason =
  | 'not_found'
  | 'wrong_status'
  | 'still_running'
  | 'unsupported'
  | 'abort_timeout';

export type TaskOpResult = { ok: true } | { ok: false; reason: TaskOpFailureReason };

/** 主进程推给渲染层的任务事件。 */
export type TaskEventPayload =
  | { type: 'created'; task: TaskSnapshot }
  | { type: 'updated'; task: TaskSnapshot }
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
