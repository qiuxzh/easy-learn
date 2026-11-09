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
