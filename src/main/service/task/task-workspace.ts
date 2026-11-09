import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { log } from '@main/logging';

/** 任务临时目录的生命周期，与 task 行绑定。 */
export interface TaskWorkspace {
  /** 任务专属目录；只返回路径，不保证已存在。 */
  pathFor(taskId: string): string;

  /** 创建目录；已存在时不报错。 */
  create(taskId: string): string;

  /**
   * 删除目录。
   *
   * 先改名到 `.retired-*` 再删：改名是原子的，进程在删除途中被杀也不会让目录
   * 以任务 id 的身份复活；残留由 {@link TaskWorkspace.sweep} 收尾。
   */
  remove(taskId: string): void;

  /** 删除没有对应任务行的目录，包括上次未删完的 `.retired-*`。 */
  sweep(knownTaskIds: Set<string>): void;
}

/**
 * 创建任务临时目录管理器。
 *
 * 目录失败只记日志：临时目录缺失不应让任务无法执行，任务最多少一个缓存位置。
 *
 * @param rootDir 根目录，通常是 `data/task-work`
 */
export function createTaskWorkspace(rootDir: string): TaskWorkspace {
  const pathFor = (taskId: string): string => path.join(rootDir, taskId);

  return {
    pathFor,

    create(taskId: string): string {
      const dir = pathFor(taskId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },

    remove(taskId: string): void {
      const dir = pathFor(taskId);
      const retired = path.join(rootDir, `.retired-${taskId}-${Date.now()}`);
      try {
        renameSync(dir, retired);
      } catch {
        return;
      }
      try {
        rmSync(retired, { recursive: true, force: true });
      } catch (error) {
        log.warn('任务临时目录删除失败，等待下次启动清理:', retired, error);
      }
    },

    sweep(knownTaskIds: Set<string>): void {
      let entries: string[];
      try {
        entries = readdirSync(rootDir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.startsWith('.retired-') || !knownTaskIds.has(name)) {
          try {
            rmSync(path.join(rootDir, name), { recursive: true, force: true });
          } catch (error) {
            log.warn('任务临时目录清理失败:', name, error);
          }
        }
      }
    },
  };
}
