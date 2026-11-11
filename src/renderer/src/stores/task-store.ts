import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskEventPayload, TaskOpResult, TaskSnapshot } from '@shared/types/task';

interface TaskState {
  /** 当前全部任务：排队、运行、暂停与失败。 */
  tasks: TaskSnapshot[];
  loading: boolean;
  error: string | null;

  /** 从主进程重新拉取任务列表。 */
  load: () => Promise<void>;
  /** 应用后端推送的任务事件。 */
  applyEvent: (event: TaskEventPayload) => void;

  pause: (taskId: string) => Promise<TaskOpResult>;
  resume: (taskId: string) => Promise<TaskOpResult>;
  cancel: (taskId: string) => Promise<TaskOpResult>;
  retry: (taskId: string) => Promise<TaskOpResult>;
  dismiss: (taskId: string) => Promise<TaskOpResult>;
}

/** 按创建时间倒序排列，保证新任务在列表顶部。 */
function sortTasks(tasks: TaskSnapshot[]): void {
  tasks.sort((left, right) => right.createdAt - left.createdAt);
}

/** 任务列表与生命周期操作。 */
export const useTaskStore = create<TaskState>()(
  immer(set => ({
    tasks: [],
    loading: false,
    error: null,

    load: async () => {
      set(state => {
        state.loading = true;
        state.error = null;
      });

      try {
        const tasks = await window.api.tasks.list();
        sortTasks(tasks);
        set(state => {
          state.tasks = tasks;
          state.loading = false;
        });
      } catch (error) {
        set(state => {
          state.loading = false;
          state.error = String(error);
        });
      }
    },

    applyEvent: event => {
      set(state => {
        switch (event.type) {
          case 'created':
          case 'updated': {
            const index = state.tasks.findIndex(task => task.id === event.task.id);
            if (index >= 0) state.tasks[index] = event.task;
            else state.tasks.push(event.task);
            sortTasks(state.tasks);
            break;
          }
          case 'progress': {
            const task = state.tasks.find(item => item.id === event.taskId);
            if (task) task.progress = event.progress;
            break;
          }
          case 'settled': {
            if (event.status === 'failed') {
              const task = state.tasks.find(item => item.id === event.taskId);
              if (task) {
                task.status = 'failed';
                task.error = event.error ?? null;
                task.failedAt = Date.now();
                task.updatedAt = task.failedAt;
              }
              break;
            }

            state.tasks = state.tasks.filter(task => task.id !== event.taskId);
            break;
          }
        }
      });
    },

    pause: taskId => window.api.tasks.pause(taskId),
    resume: taskId => window.api.tasks.resume(taskId),
    cancel: async taskId => {
      const result = await window.api.tasks.cancel(taskId);

      if (result.ok || result.reason === 'not_found') {
        set(state => {
          state.tasks = state.tasks.filter(task => task.id !== taskId);
        });
      }

      return result;
    },
    retry: taskId => window.api.tasks.retry(taskId),
    dismiss: taskId => window.api.tasks.dismiss(taskId),
  }))
);

/** 是否已经挂上监听。事件监听必须常驻，重复调用只生效一次。 */
let initialized = false;

/**
 * 订阅任务事件并拉取一次初始列表。
 *
 * 任务可能在任意页面发起，监听要一直挂着，不能等打开任务页才开始听。
 */
export function ensureTaskStreamInitialized(): void {
  if (initialized) return;
  initialized = true;

  window.api.tasks.onEvent(event => {
    useTaskStore.getState().applyEvent(event);
  });

  void useTaskStore.getState().load();
}
