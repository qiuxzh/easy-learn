import { IpcChannel } from '@shared/ipc-channels';
import type { TaskIdInput } from '@shared/types/task';
import type { TaskScheduler } from '@main/service/task/task-scheduler';
import { toTaskSnapshot } from '@main/service/task/task-event-mapper';
import { registerDirectHandler } from './register-handler';

/**
 * 注册任务编排器的通道。
 *
 * 暂停/继续/取消/重试的预期拒绝用 `TaskOpResult` 返回，不抛异常；
 * 只有内部错误才走 rejection。
 *
 * @param tasks 装配根持有的任务调度器
 */
export function registerTaskHandlers(tasks: TaskScheduler): void {
  registerDirectHandler(IpcChannel.Task_List, () => tasks.list().map(toTaskSnapshot));

  registerDirectHandler(IpcChannel.Task_Get, (input: TaskIdInput) => {
    const task = tasks.get(input.taskId);
    return task ? toTaskSnapshot(task) : null;
  });

  registerDirectHandler(IpcChannel.Task_Pause, (input: TaskIdInput) => tasks.pause(input.taskId));

  registerDirectHandler(IpcChannel.Task_Resume, (input: TaskIdInput) => tasks.resume(input.taskId));

  registerDirectHandler(IpcChannel.Task_Cancel, (input: TaskIdInput) => tasks.cancel(input.taskId));

  registerDirectHandler(IpcChannel.Task_Retry, (input: TaskIdInput) => tasks.retry(input.taskId));

  registerDirectHandler(IpcChannel.Task_Dismiss, (input: TaskIdInput) =>
    tasks.dismiss(input.taskId)
  );
}
