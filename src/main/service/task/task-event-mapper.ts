import type { TaskEntity, TaskEvent } from '@main/contracts/task';
import type { TaskEventPayload, TaskSnapshot } from '@shared/types/task';

/** 主进程实体裁剪成渲染层快照。 */
export function toTaskSnapshot(task: TaskEntity): TaskSnapshot {
  return {
    id: task.id,
    taskType: task.taskType,
    status: task.status,
    progress: task.progress,
    payload: task.payload,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    failedAt: task.failedAt,
  };
}

/** 调度器事件转成 IPC 载荷；字段一一对应，不做业务翻译。 */
export function toTaskEventPayload(event: TaskEvent): TaskEventPayload {
  switch (event.type) {
    case 'created':
      return { type: 'created', task: toTaskSnapshot(event.task) };
    case 'updated':
      return { type: 'updated', task: toTaskSnapshot(event.task) };
    case 'progress':
      return {
        type: 'progress',
        taskId: event.taskId,
        progress: event.progress,
      };
    case 'settled':
      return {
        type: 'settled',
        taskId: event.taskId,
        status: event.status,
        error: event.error,
      };
  }
}
