import type { TaskError, TaskProgress } from '@shared/types/task';
import type { TaskCreate, TaskEntity } from './task';

/** task 表的持久化接口。 */
export interface TaskRepo {
  /** 新建排队记录并返回落库后的实体。 */
  create(data: TaskCreate): TaskEntity;

  /** 按 id 查询。 */
  findById(id: string): TaskEntity | undefined;

  /** 全部任务，按创建时间升序。 */
  list(): TaskEntity[];

  /** 排队中的任务，按创建时间升序。 */
  listQueued(): TaskEntity[];

  /**
   * 启动恢复：把全部 `running` 改判为 `queued`，返回改判条数。
   *
   * 进程被杀时没有机会清理 running 行；handler 必须幂等，续跑靠它自己查域表。
   */
  recoverRunning(): number;

  /** 原子领取某任务类型的队首；没有排队任务时返回 undefined。 */
  claimNext(taskType: string): TaskEntity | undefined;

  /** 覆盖进度快照。 */
  updateProgress(id: string, progress: TaskProgress): void;

  /** 把 running 行落为 paused，保留进度与 workspace。 */
  markPaused(id: string): void;

  /** 把 paused 行放回队列。 */
  markQueued(id: string): void;

  /** 标记失败并保留行。 */
  fail(id: string, error: TaskError): void;

  /** 删除行；完成与取消调用。 */
  remove(id: string): void;

  /** 失败任务重新入队：清错误与时间，保留进度与 payload。 */
  requeue(id: string): void;
}
