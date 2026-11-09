import { DomainError } from '@main/domain-error';
import { log } from '@main/logging';
import type { TaskRepo } from '@main/contracts/task-repo';
import type {
  TaskContext,
  TaskDefinition,
  TaskEntity,
  TaskEvent,
  TaskOpResult,
} from '@main/contracts/task';
import { TaskFailure } from '@main/contracts/task';
import type { TaskError, TaskProgress } from '@shared/types/task';
import type { TaskWorkspace } from './task-workspace';

/** 派发轮询间隔。 */
const DEFAULT_TICK_MS = 300;
/** 进度落库节流；一次完成不受限制。 */
const DEFAULT_PROGRESS_FLUSH_MS = 500;
/** 发出 abort 后等待 handler 停稳的宽限。 */
const DEFAULT_ABORT_GRACE_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

type AbortReason = 'pause' | 'cancel' | 'timeout' | 'shutdown';

/**
 * Task 运行时对象
 */
interface TaskExecution {
  controller: AbortController;
  /** handler 的 Promise 结束（成功、失败或中止）后 resolve。 */
  done: Promise<void>;
  lastProgressAt: number;
  timeout?: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
}

export interface TaskSchedulerOptions {
  taskRepo: TaskRepo;
  definitions: TaskDefinition[];
  workspace: TaskWorkspace;
  /** 事件出口，由装配根接到 IPC。 */
  onEvent?: (event: TaskEvent) => void;
  tickMs?: number;
  progressFlushMs?: number;
  abortGraceMs?: number;
  defaultTimeoutMs?: number;
}

/**
 * 后台任务调度器。
 *
 * 负责执行层面的全部横切关注点：持久化、排队、并发、暂停/取消/重试、崩溃恢复与事件。
 * 不感知业务产物，也不替 handler 决定续跑位置——续跑事实来自各任务自己的域表。
 */
export class TaskScheduler {
  private readonly taskRepo: TaskRepo;
  private readonly definitions: Map<string, TaskDefinition>;
  /** 任务类型到并发上限，由各自的定义声明；调度器不认识具体任务。 */
  private readonly concurrencyLimits: Map<string, number>;
  private readonly workspace: TaskWorkspace;
  private readonly onEvent?: (event: TaskEvent) => void;
  private readonly tickMs: number;
  private readonly progressFlushMs: number;
  private readonly abortGraceMs: number;
  private readonly defaultTimeoutMs: number;

  private readonly running = new Map<string, TaskExecution>();
  private readonly runningByTaskType = new Map<string, number>();
  private readonly abortReasons = new Map<string, AbortReason>();
  /** 已落过终态的任务；handler 迟到结束或强制失败后不再改库。 */
  private readonly settledTasks = new Set<string>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(options: TaskSchedulerOptions) {
    this.taskRepo = options.taskRepo;
    this.definitions = new Map(
      options.definitions.map(definition => [definition.taskType, definition])
    );
    this.concurrencyLimits = buildConcurrencyLimits(options.definitions);
    this.workspace = options.workspace;
    this.onEvent = options.onEvent;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.progressFlushMs = options.progressFlushMs ?? DEFAULT_PROGRESS_FLUSH_MS;
    this.abortGraceMs = options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * 启动调度：恢复中断任务、清理孤儿目录，然后开始派发。
   *
   * 恢复把所有 `running` 改判为 `queued`，因此进程被杀后不会残留「假 running」。
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const recovered = this.taskRepo.recoverRunning();
    this.workspace.sweep(new Set(this.taskRepo.list().map(task => task.id)));
    this.rejectUnrunnable();

    if (recovered > 0) log.info(`任务调度器恢复 ${recovered} 条中断任务`);
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  /**
   * 入队。
   *
   * 目录创建失败时回滚任务行，避免留下一条永远跑不起来的排队任务。
   *
   * @throws 任务类型未注册或未声明并发上限时抛 {@link DomainError}
   */
  enqueue(input: { taskType: string; payload: unknown }): TaskEntity {
    const definition = this.definitions.get(input.taskType);
    if (!definition) throw new DomainError(`未注册的任务类型：${input.taskType}`);
    if (!this.concurrencyLimits.has(definition.taskType)) {
      throw new DomainError(`未配置并发上限：${definition.taskType}`);
    }

    const task = this.taskRepo.create({
      taskType: definition.taskType,
      payload: input.payload,
    });

    try {
      this.workspace.create(task.id);
    } catch (error) {
      this.taskRepo.remove(task.id);
      throw error instanceof Error ? error : new Error(String(error));
    }

    this.emit({ type: 'created', task });
    this.tick();
    return task;
  }

  /**
   * 暂停。
   *
   * 排队中的任务直接落 paused；运行中的先 abort，等 handler 停稳后落 paused。
   * 宽限内停不下来时判 `failed(ABORT_TIMEOUT)`，不假装暂停成功。
   */
  async pause(id: string): Promise<TaskOpResult> {
    const task = this.taskRepo.findById(id);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.status === 'paused') return { ok: true };
    if (task.status === 'failed') return { ok: false, reason: 'wrong_status' };
    if (task.status === 'queued') {
      this.taskRepo.markPaused(id);
      this.emitTask(id);
      return { ok: true };
    }

    const definition = this.definitions.get(task.taskType);
    if (definition?.resume === 'none') return { ok: false, reason: 'unsupported' };

    const execution = this.running.get(id);
    if (!execution) return { ok: false, reason: 'wrong_status' };
    if (this.abortReasons.has(id)) return { ok: false, reason: 'still_running' };

    this.abortReasons.set(id, 'pause');
    // 运行中的任务不在这里写 paused：abort 是异步的，只有 handler 的拒绝路径能确定它已停稳
    execution.controller.abort();
    const settled = await this.waitSettled(execution.done);
    if (settled) {
      return this.taskRepo.findById(id)?.status === 'paused'
        ? { ok: true } // running 状态暂停
        : { ok: false, reason: 'wrong_status' };
    }
    this.failNow(id, {
      code: 'ABORT_TIMEOUT',
      message: '任务未在宽限时间内停止',
      retryable: true,
    });
    return { ok: false, reason: 'abort_timeout' };
  }

  /** 恢复暂停的任务；重新派发后由 handler 自己跳过已完成的单元。 */
  async resume(id: string): Promise<TaskOpResult> {
    const task = this.taskRepo.findById(id);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.status !== 'paused') return { ok: false, reason: 'wrong_status' };

    this.taskRepo.markQueued(id);
    this.emitTask(id);
    this.tick();
    return { ok: true };
  }

  /**
   * 取消。
   *
   * 运行中的先 abort，停稳后删行；排队、暂停、失败的行直接删。
   * 取消不清理业务产物，只删任务行与它自己的临时目录。
   */
  async cancel(id: string): Promise<TaskOpResult> {
    const task = this.taskRepo.findById(id);
    if (!task) return { ok: false, reason: 'not_found' };

    if (task.status !== 'running') {
      this.taskRepo.remove(id);
      this.workspace.remove(id);
      this.emit({ type: 'settled', taskId: id, status: 'cancelled' });
      return { ok: true };
    }

    const execution = this.running.get(id);
    if (!execution) {
      this.taskRepo.remove(id);
      this.workspace.remove(id);
      this.emit({ type: 'settled', taskId: id, status: 'cancelled' });
      return { ok: true };
    }
    if (this.abortReasons.has(id)) return { ok: false, reason: 'still_running' };

    this.abortReasons.set(id, 'cancel');
    execution.controller.abort();
    const settled = await this.waitSettled(execution.done);
    if (!settled) {
      this.failNow(id, {
        code: 'ABORT_TIMEOUT',
        message: '任务未在宽限时间内停止',
        retryable: true,
      });
      return { ok: false, reason: 'abort_timeout' };
    }
    return this.taskRepo.findById(id) ? { ok: false, reason: 'wrong_status' } : { ok: true };
  }

  /**
   * 重试失败任务。
   *
   * 保留 payload、进度与临时目录：进度是展示快照，续跑事实来自域表。
   * 旧执行还没退出时拒绝，避免同一行并发跑两份 handler。
   */
  async retry(id: string): Promise<TaskOpResult> {
    const task = this.taskRepo.findById(id);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.status !== 'failed') return { ok: false, reason: 'wrong_status' };
    if (this.running.has(id)) return { ok: false, reason: 'still_running' };
    if (!this.definitions.has(task.taskType)) return { ok: false, reason: 'unsupported' };

    this.taskRepo.requeue(id);
    this.emitTask(id);
    this.tick();
    return { ok: true };
  }

  /** 忽略失败任务：删行与临时目录，不重试。 */
  async dismiss(id: string): Promise<TaskOpResult> {
    const task = this.taskRepo.findById(id);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.status !== 'failed') return { ok: false, reason: 'wrong_status' };
    if (this.running.has(id)) return { ok: false, reason: 'still_running' };

    this.taskRepo.remove(id);
    this.workspace.remove(id);
    this.emit({ type: 'settled', taskId: id, status: 'cancelled' });
    return { ok: true };
  }

  get(id: string): TaskEntity | undefined {
    return this.taskRepo.findById(id);
  }

  list(): TaskEntity[] {
    return this.taskRepo.list();
  }

  /** 订阅任务事件，返回退订函数。 */
  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 停止调度。
   *
   * 立即 abort 所有运行中的任务，然后最多等 `drainMs` 让它们自己退出，避免退出流程卡住。没停稳的行保持 running，下次启动由 `start` 改判为 queued 并续跑；
   * 因此 handler 必须幂等，且不能在 abort 后假设自己还拥有数据库。
   *
   * @param drainMs 退出前等待 handler 停稳的时间预算；默认 200ms
   */
  async shutdown(drainMs = 200): Promise<void> {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const executions = [...this.running.values()];
    for (const [id, execution] of this.running) {
      if (!this.abortReasons.has(id)) this.abortReasons.set(id, 'shutdown');
      execution.controller.abort();
      if (execution.timeout) clearTimeout(execution.timeout);
      if (execution.grace) clearTimeout(execution.grace);
    }
    if (executions.length > 0) {
      await this.waitForDrain(
        executions.map(execution => execution.done),
        drainMs
      );
    }
  }

  /** 等一组 handler 退出，最多 `drainMs`；到点直接放行。 */
  private waitForDrain(dones: Promise<void>[], drainMs: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, drainMs);
      void Promise.allSettled(dones).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private tick(): void {
    if (!this.started) return;
    for (const [taskType, limit] of this.concurrencyLimits) {
      while ((this.runningByTaskType.get(taskType) ?? 0) < limit) {
        const task = this.taskRepo.claimNext(taskType);
        if (!task) break;
        this.run(task);
      }
    }
  }

  /** 收尾：拒绝没有对应处理器的历史任务，避免永远卡在队列里。 */
  private rejectUnrunnable(): void {
    for (const task of this.taskRepo.listQueued()) {
      const definition = this.definitions.get(task.taskType);
      if (definition && this.concurrencyLimits.has(definition.taskType)) continue;
      this.failNow(task.id, {
        code: 'NO_HANDLER',
        message: `未注册或不可调度的任务类型：${task.taskType}`,
        retryable: false,
      });
    }
  }

  /**
   * 执行领取到的任务：设置超时、构造上下文，并在 handler 结束后落终态。
   *
   * 每次执行都建独立 AbortController；`done` 用于暂停/取消时等待停稳，
   * 迟到结束的 handler 由 `settledTasks` 拦住，不再改库。
   *
   * @param task 已从队列领取、状态为 running 的记录
   */
  private run(task: TaskEntity): void {
    const definition = this.definitions.get(task.taskType);
    if (!definition) {
      this.failNow(task.id, {
        code: 'NO_HANDLER',
        message: `未注册的任务类型：${task.taskType}`,
        retryable: false,
      });
      return;
    }

    const controller = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => {
      resolveDone = resolve;
    });
    const execution: TaskExecution = {
      controller,
      done,
      lastProgressAt: 0,
    };

    this.running.set(task.id, execution);
    this.runningByTaskType.set(task.taskType, (this.runningByTaskType.get(task.taskType) ?? 0) + 1);
    this.emit({ type: 'updated', task });

    const timeoutTimer = setTimeout(
      () => this.handleTimeout(task, execution),
      definition.timeoutMs ?? this.defaultTimeoutMs
    );
    execution.timeout = timeoutTimer;

    const ctx: TaskContext = {
      taskId: task.id,
      payload: task.payload,
      signal: controller.signal,
      workspaceDir: this.workspace.pathFor(task.id),
      report: (finished, total) => {
        const now = Date.now();
        if (finished < total && now - execution.lastProgressAt < this.progressFlushMs) return;
        execution.lastProgressAt = now;
        const ratio = total > 0 ? Math.min(finished / total, 1) : 0;
        const progress: TaskProgress = { kind: 'ratio', ratio };
        this.taskRepo.updateProgress(task.id, progress);
        this.emit({ type: 'progress', taskId: task.id, progress });
      },
    };

    void definition
      .run(ctx)
      .then(
        () => this.handleSuccess(task.id),
        cause => this.handleRunRejected(task.id, cause)
      )
      .finally(() => {
        clearTimeout(timeoutTimer);
        if (execution.grace) clearTimeout(execution.grace);
        this.running.delete(task.id);
        this.abortReasons.delete(task.id);
        this.settledTasks.delete(task.id);
        this.releaseTaskType(task.taskType);
        this.tick();
        resolveDone();
      });
  }

  /** 超时：abort 后仍给 handler 一个宽限；停不下来就强制落失败。 */
  private handleTimeout(task: TaskEntity, execution: TaskExecution): void {
    if (!this.started || this.settledTasks.has(task.id)) return;
    this.abortReasons.set(task.id, 'timeout');
    execution.controller.abort();
    execution.grace = setTimeout(() => {
      if (!this.started || this.settledTasks.has(task.id) || !this.running.has(task.id)) return;
      this.failTimeout(task.id);
    }, this.abortGraceMs);
  }

  private handleSuccess(id: string): void {
    if (this.settledTasks.has(id)) return;
    this.settledTasks.add(id);
    this.taskRepo.remove(id);
    this.workspace.remove(id);
    this.emit({ type: 'settled', taskId: id, status: 'completed' });
  }

  /** handler 拒绝后的收尾：有 abort 原因时按原因落终态，否则按真实失败处理。 */
  private handleRunRejected(id: string, cause: unknown): void {
    if (this.settledTasks.has(id)) return;

    const reason = this.abortReasons.get(id);
    if (reason) {
      this.handleAbortOutcome(id, reason);
      return;
    }

    this.failNow(id, toTaskError(cause));
  }

  /** 按 abort 原因落终态；pause/cancel/timeout 都在这里写，避免 handler 迟到结束造成双写。 */
  private handleAbortOutcome(id: string, reason: AbortReason): void {
    if (reason === 'shutdown') return;

    if (reason === 'pause') {
      this.settledTasks.add(id);
      this.taskRepo.markPaused(id);
      this.emitTask(id);
      return;
    }
    if (reason === 'cancel') {
      this.settledTasks.add(id);
      this.taskRepo.remove(id);
      this.workspace.remove(id);
      this.emit({ type: 'settled', taskId: id, status: 'cancelled' });
      return;
    }

    this.failTimeout(id);
  }

  private failTimeout(id: string): void {
    this.failNow(id, {
      code: 'TIMEOUT',
      message: '任务执行超时',
      retryable: true,
    });
  }

  private failNow(id: string, error: TaskError): void {
    if (this.settledTasks.has(id)) return;
    this.settledTasks.add(id);
    this.taskRepo.fail(id, error);
    this.emit({ type: 'settled', taskId: id, status: 'failed', error });
  }

  private waitSettled(done: Promise<void>): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), this.abortGraceMs);
      void done.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private releaseTaskType(taskType: string): void {
    this.runningByTaskType.set(
      taskType,
      Math.max((this.runningByTaskType.get(taskType) ?? 1) - 1, 0)
    );
  }

  private emitTask(id: string): void {
    const task = this.taskRepo.findById(id);
    if (task) this.emit({ type: 'updated', task });
  }

  private emit(event: TaskEvent): void {
    if (this.onEvent) this.safeNotify(this.onEvent, event);
    for (const listener of this.listeners) this.safeNotify(listener, event);
  }

  private safeNotify(listener: (event: TaskEvent) => void, event: TaskEvent): void {
    try {
      listener(event);
    } catch (error) {
      log.error('任务事件监听器抛错:', error);
    }
  }
}

/**
 * 从任务类型声明推导并发上限。
 *
 * 每个任务类型各自限流，不做跨类型共享；重复声明同一个 taskType 是配置错误，
 * 在构造时报出来，而不是运行期悄悄按其中一个执行。
 *
 * @param definitions 已注册的任务类型
 * @throws 上限不是正整数或 taskType 重复时抛出
 */
function buildConcurrencyLimits(definitions: TaskDefinition[]): Map<string, number> {
  const limits = new Map<string, number>();
  for (const definition of definitions) {
    if (!Number.isInteger(definition.maxConcurrency) || definition.maxConcurrency <= 0) {
      throw new Error(`任务类型 ${definition.taskType} 的并发上限必须是正整数`);
    }
    if (limits.has(definition.taskType)) {
      throw new Error(`任务类型重复注册：${definition.taskType}`);
    }
    limits.set(definition.taskType, definition.maxConcurrency);
  }
  return limits;
}

/**
 * 把 handler 抛出的异常收敛成任务错误。
 *
 * `TaskFailure` 保留业务给的码与可重试标记；其它异常按可重试失败处理，
 * 因为多数是网络或临时资源问题。
 */
function toTaskError(cause: unknown): TaskError {
  if (cause instanceof TaskFailure) {
    return { code: cause.code, message: cause.message, retryable: cause.retryable };
  }
  if (cause instanceof Error) {
    return { code: 'FAILED', message: cause.message, retryable: true };
  }
  return { code: 'FAILED', message: String(cause), retryable: true };
}
