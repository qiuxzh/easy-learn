import log from 'electron-log';
import { runInTransaction } from '@main/db';
import {
  bookChunkRepo,
  bookEmbeddingRepo,
  bookStageRepo,
  embedIndexRepo,
  embedVectorRepo,
} from '@main/db/repo';
import type { PendingChunk } from '@main/db/repo';
import { encodeVector } from '@main/db/embedding-identity';
import type {
  EmbedCommandResult,
  EmbedStartMode,
  EmbedStartRequest,
  EmbedTaskPhase,
  EmbeddingRuntime,
} from '@shared/types/embedding';
import { embedTexts } from './embedding-client';
import { resolveActiveModel } from './embedding-model';
import type { EmbedIndexRef, ResolvedModel } from './embedding-model';

/** 每批处理的分片数。同时决定暂停的响应延迟，以及崩溃时最多丢掉多少已请求的向量。 */
const BATCH_SIZE = 32;

const RATE_WINDOW = 5;

/** 一批的耗时与分片数。 */
export interface RateSample {
  count: number;
  elapsedMs: number;
}

export interface ProgressEstimate {
  /** 分片 / 秒 */
  rate: number;
  /** 预计剩余毫秒；无法估计时为 null */
  etaMs: number | null;
}

export interface RunProgress {
  /** 这本书的分片总数 */
  total: number;
  /** 已经有向量行的分片数，不是本次运行写入的数量 */
  done: number;
  /** 分片 / 秒，取最近几批的滑动窗口；样本不足时为 0 */
  rate: number;
  /** 预计剩余毫秒；无法估计时为 null */
  etaMs: number | null;
}

/** 一次运行的结果。 */
export interface RunOutcome {
  status: 'done' | 'paused' | 'cancelled' | 'failed';
  /** 本次运行实际写入的分片数 */
  processed: number;
  /** status 为 failed 时的原因 */
  error?: string;
}

/** 跑一本书所需的上下文。 */
export interface RunContext {
  bookId: string;
  mode: EmbedStartMode;
  model: ResolvedModel;
  /** 只在批次边界调用；返回非 null 表示立刻停下并给出原因 */
  checkStop: () => 'paused' | 'cancelled' | null;
  /** 开始前、每批结束后各调用一次，参数是这本书的累计进度 */
  onProgress: (progress: RunProgress) => void;
}

/**
 * 用最近几批的滑动窗口估速率与剩余时间。
 *
 * 不用全程平均：被限流之后，全程平均会严重偏乐观，剩余时间一路往后跳。
 * 样本不足或总耗时为 0 时返回 `etaMs: null`，避免给出乱跳的数字。
 */
export function estimateProgress(samples: RateSample[], remaining: number): ProgressEstimate {
  const window = samples.slice(-RATE_WINDOW);
  const totalCount = window.reduce((sum, sample) => sum + sample.count, 0);
  const totalMs = window.reduce((sum, sample) => sum + sample.elapsedMs, 0);
  if (totalCount === 0 || totalMs <= 0) {
    return { rate: 0, etaMs: null };
  }

  const rate = (totalCount / totalMs) * 1000;
  if (remaining <= 0) {
    return { rate, etaMs: 0 };
  }
  return { rate, etaMs: Math.round((remaining / rate) * 1000) };
}

/**
 * 取下一批待处理的分片。
 *
 * 判据只有一条：没有向量行。它同时覆盖「从没做过」和「上次失败停在这里」两种情况，
 * 所以不需要失败明细表，也不需要游标：判据本身就是幂等的。
 *
 * 首次使用一套模型参数时向量表还不存在，没法用「排除已有向量」的查询，
 * 于是先取开头若干分片；这批做完表就建好了，之后走正常路径。
 */
function takeBatch(bookId: string, index: EmbedIndexRef | null): PendingChunk[] {
  if (!index) {
    return bookChunkRepo
      .listFirstByBookId(bookId, BATCH_SIZE)
      .map(row => ({ chunkId: row.id, content: row.content }));
  }
  return embedVectorRepo.listPendingBookChunks(index.tableName, bookId, BATCH_SIZE);
}

/**
 * 落库一批向量。首次调用时顺带建表并注册索引。
 *
 * 建表、注册、写向量、累加阶段进度必须在同一个事务里：拆开写时崩溃，会留下有记录
 * 却没有表的孤儿，或者有表却没有记录的悬空状态。
 *
 * 表名由维度与指纹派生，两者在建表前就确定，注册记录可以直接填表名。
 */
function persistBatch(
  bookId: string,
  model: ResolvedModel,
  index: EmbedIndexRef | null,
  batch: PendingChunk[],
  vectors: number[][],
  dimension: number,
  total: number
): EmbedIndexRef {
  return runInTransaction(() => {
    let resolved = index;
    if (!resolved) {
      // 两本书可能同时首次使用同一个模型：各自看到的 index 都是 null，
      // 先到的已经注册，后到的必须复用，否则会撞指纹唯一约束
      const existing = embedIndexRepo.findByFingerprint(model.fingerprint);
      if (existing) {
        resolved = {
          id: existing.id,
          tableName: existing.tableName,
          dimension: existing.dimension,
        };
      } else {
        const ref = embedVectorRepo.ensureTable(dimension, model.fingerprint);
        const row = embedIndexRepo.create({
          fingerprint: model.fingerprint,
          tableName: ref.tableName,
          modelId: model.modelId,
          dimension,
          lastLabel: model.label,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        });
        resolved = { id: row.id, tableName: row.tableName, dimension: row.dimension };
      }
    }
    const target = resolved;

    const rows = batch.map((chunk, position) => ({
      chunkId: chunk.chunkId,
      sourceId: bookId,
      sourceType: 'book' as const,
      vector: encodeVector(vectors[position], target.dimension),
    }));

    // 写向量与累加阶段进度同事务，保证 done 不会滞后于向量行。
    embedVectorRepo.insertBatch(target, rows);
    bookStageRepo.addEmbedDone({
      bookId,
      total,
      identity: model.fingerprint,
      delta: rows.length,
    });
    embedIndexRepo.touch(target.id, Date.now(), model.label);
    return target;
  });
}

/**
 * 跑完一本书的向量化。
 *
 * 失败只记下原因然后停，不记录是哪几个分片失败：失败的那一批本来就没有向量行，
 * 下次运行自然从那里重来。这样既不需要失败明细表，也不会出现「一批里少数分片
 * 失败却把整批记成失败」。
 *
 * 两种模式共用这一个循环，差别只在开头那一次清理：`rebuild` 连当前模型的一起清，
 * `resume` 只清别的模型，当前模型下没做完的部分接着做。
 */
export async function runBookEmbedding(ctx: RunContext): Promise<RunOutcome> {
  const { bookId, mode, model, checkStop, onProgress } = ctx;

  // 一本书只允许有一份向量数据，否则同一本书会同时是「当前模型下没做」和
  // 「旧模型下做完了」，状态就说不清。每次开始先清掉别的模型留下的产物。
  //
  // 重新向量化传 null（连当前模型的一起清），但索引注册记录要留着：清掉的只是
  // 向量行与阶段计数，表和注册记录本来就该复用。把 index 置空会让下面重新建一次，
  // 撞上指纹的唯一约束。
  let index = model.index;
  bookEmbeddingRepo.drop(bookId, mode === 'rebuild' ? null : (index?.id ?? null));

  const total = bookChunkRepo.countByBookId(bookId);
  if (total === 0) {
    return { status: 'done', processed: 0 };
  }

  let done = 0;
  if (index) {
    // 以向量表为准校正阶段计数：阶段行可能因崩溃或模型来回切换而与向量表对不上。
    // 只在任务开始时做一次；运行期以向量表为准，阶段行只服务于总览。
    const actual = embedVectorRepo.countBySource(index.tableName, bookId);
    const row = bookStageRepo.find(bookId, 'embed');
    if (!row || row.identity !== model.fingerprint || row.done !== actual) {
      bookStageRepo.setEmbedDone({
        bookId,
        total,
        identity: model.fingerprint,
        done: actual,
      });
    }
    // 清掉上一次的失败原因：本次运行还没失败，lastError 不该继续保留
    if (row?.lastError) {
      bookStageRepo.clearError(bookId, 'embed');
    }
    done = actual;
  }

  let processed = 0;
  const samples: RateSample[] = [];

  /** 把当前计数连同速率与剩余时间一起推出去。 */
  const publish = (): void => {
    const remaining = Math.max(0, total - done);
    const { rate, etaMs } = estimateProgress(samples, remaining);
    onProgress({ total, done, rate, etaMs });
  };

  publish();

  for (;;) {
    const stop = checkStop();
    if (stop) {
      return { status: stop, processed };
    }

    // 配置在运行期间被改了：这本书会一半写在旧模型下、一半写在新模型下，
    // 两种向量空间无法混用，只能停下并报错。
    const active = resolveActiveModel();
    if (active?.fingerprint !== model.fingerprint) {
      const error = active
        ? `向量模型已变更为「${active.label}」，任务已停止。切回「${model.label}」可以接着做，或对新模型重新向量化。`
        : '向量模型配置已被移除，任务已停止。';
      bookStageRepo.setEmbedError({ bookId, total, error });
      return { status: 'failed', processed, error };
    }

    const batch = takeBatch(bookId, index);
    if (batch.length === 0) {
      return { status: 'done', processed };
    }

    const startedAt = Date.now();
    const result = await embedTexts(
      { endpoint: model.endpoint, modelId: model.modelId, apiKey: model.apiKey },
      batch.map(chunk => chunk.content)
    );
    samples.push({ count: batch.length, elapsedMs: Date.now() - startedAt });

    if (!result.ok) {
      // 失败原因也写进阶段行：即使一条向量都没写入，也会留下「试过、停在这里」的记录，
      // 下次启动仍能读到，不必只靠返回值带出去。
      bookStageRepo.setEmbedError({ bookId, total, error: result.message });
      // 库里只留一条原因；具体是哪一批分片失败写日志
      log.error(
        `[Embedding] 批次失败 book=${bookId} chunks=${batch.map(c => c.chunkId).join(',')} ${result.message}`
      );
      publish();
      return { status: 'failed', processed, error: result.message };
    }

    // 指纹没变而维度变了，说明服务端换了模型：继续写会把两种向量空间混进同一张表
    if (index && index.dimension !== result.dimension) {
      const error = `接口返回 ${result.dimension} 维，与已建索引的 ${index.dimension} 维不一致`;
      bookStageRepo.setEmbedError({ bookId, total, error });
      return { status: 'failed', processed, error };
    }

    index = persistBatch(bookId, model, index, batch, result.vectors, result.dimension, total);
    done += batch.length;
    processed += batch.length;
    publish();
  }
}

/** 运行态变化都走这一个回调，包括任务开始、进度推进、暂停与结束。 */
export interface BookEmbeddingRunnerEvents {
  onRuntime: (runtime: EmbeddingRuntime) => void;
}

/** tasks 里的每一项：正在处理、或已暂停等待恢复的任务。完成、失败、取消的任务会被移除。 */
interface RunningTask {
  bookId: string;
  mode: EmbedStartMode;
  /** 任务开始时锁定的模型，运行期间不再读配置 */
  model: ResolvedModel;
  phase: EmbedTaskPhase;
  /** 最近一次的进度数字 */
  progress: RunProgress;
  /** 置位后循环在下一个批次边界退出 */
  cancelled: boolean;
  /** 是否已有循环在跑。暂停期间 resume 不能开出第二条循环 */
  loopActive: boolean;
}

/**
 * 每本书一条独立的向量化循环，没有队列：`start` 即执行，多本并行。
 * 并发数就是 `start` 的调用次数，不需要调度器；一本书暂停或失败不影响其它书。
 *
 * 暂停、取消这些任务状态只留在内存，不落库：进程被杀后没有需要补偿的状态，
 * 待处理集合从数据库推导得出，下次 `start` 自然接着跑。
 *
 * 对外输出全部走构造注入的 `onRuntime` 回调。
 */
export class BookEmbeddingRunner {
  private readonly events: BookEmbeddingRunnerEvents;

  /** 正在处理或已暂停的任务，按书索引；空闲时为空 */
  private readonly tasks = new Map<string, RunningTask>();

  constructor(events: BookEmbeddingRunnerEvents) {
    this.events = events;
  }

  /**
   * 启动一本书的向量化。同一本书已有任务时返回失败。
   *
   * `resume` 同时承担「开始」与「继续」：待处理集合从数据库推导得出，
   * 做过什么、还差什么一目了然，两者不需要区分。
   */
  start(req: EmbedStartRequest): EmbedCommandResult {
    const bookId = req.bookId?.trim();
    if (!bookId) {
      return { success: false, error: '缺少书籍 id' };
    }
    if (this.tasks.has(bookId)) {
      return { success: false, error: '这本书正在处理中' };
    }

    const model = resolveActiveModel();
    if (!model) {
      return { success: false, error: '尚未配置或选择向量模型' };
    }

    const task: RunningTask = {
      bookId,
      mode: req.mode === 'rebuild' ? 'rebuild' : 'resume',
      model,
      phase: 'running',
      progress: { total: 0, done: 0, rate: 0, etaMs: null },
      cancelled: false,
      loopActive: false,
    };
    this.tasks.set(bookId, task);
    this.publish();
    void this.execute(task);
    return { success: true };
  }

  /**
   * 暂停某本书。当前批次会先跑完：中途断开会让已经发出的请求既没落库也不算数，
   * 重启后还要重新取出来再花一次钱。
   */
  pause(bookId: string): EmbedCommandResult {
    const task = this.tasks.get(bookId);
    if (!task) {
      return { success: false, error: '这本书没有正在进行的任务' };
    }
    if (task.phase === 'paused') {
      return { success: false, error: '任务已经处于暂停状态' };
    }
    task.phase = 'paused';
    this.publish();
    return { success: true };
  }

  /** 从暂停处继续某本书。已经写好的向量不重做。 */
  resume(bookId: string): EmbedCommandResult {
    const task = this.tasks.get(bookId);
    if (task?.phase !== 'paused') {
      return { success: false, error: '这本书没有暂停的任务' };
    }
    task.phase = 'running';
    // rebuild 的清理在暂停之前就做完了，接着跑等同于「继续」
    task.mode = 'resume';
    this.publish();
    // 循环可能还停在批次里没退出，这时不能另起一条；execute 会自己识别
    void this.execute(task);
    return { success: true };
  }

  /** 取消某本书。已经写好的向量保留，不删已经花过钱的产物。 */
  cancel(bookId: string): EmbedCommandResult {
    const task = this.tasks.get(bookId);
    if (!task) {
      return { success: false, error: '这本书没有正在进行的任务' };
    }
    if (task.phase === 'paused') {
      // 循环已经退出，没有地方再检查取消标志，只能直接收尾
      task.cancelled = true;
      this.tasks.delete(bookId);
      this.publish();
      return { success: true };
    }
    task.cancelled = true;
    return { success: true };
  }

  /** 当前所有任务的运行态快照。 */
  describe(): EmbeddingRuntime {
    return {
      tasks: [...this.tasks.values()].map(task => ({
        bookId: task.bookId,
        phase: task.phase,
        total: task.progress.total,
        done: task.progress.done,
        rate: task.progress.rate,
        etaMs: task.progress.etaMs,
      })),
    };
  }

  /** 跑一个任务；结束时移除它，暂停则保留等待 resume。 */
  private async execute(task: RunningTask): Promise<void> {
    // 暂停在批次边界生效：暂停请求发出后循环可能还没退出，
    // 这时 resume 只要把 phase 改回来，不能再开一条循环
    if (task.loopActive) return;

    task.loopActive = true;
    try {
      const outcome = await runBookEmbedding({
        bookId: task.bookId,
        mode: task.mode,
        model: task.model,
        checkStop: () => {
          if (task.cancelled) return 'cancelled';
          return task.phase === 'paused' ? 'paused' : null;
        },
        onProgress: progress => {
          task.progress = progress;
          // 进度与阶段必须一起推：暂停可能在一批中途生效，这一批结束时若只推进度，
          // 会把已经发布的 paused 覆盖回 running。
          this.publish();
        },
      });

      if (outcome.status === 'paused') {
        // 任务保留在 tasks 里，等 resume 接着跑
        return;
      }
      if (outcome.status === 'failed') {
        // 原因已写进 book_stage.last_error；这里补一条日志，记录哪本书、什么原因
        log.warn(`[Embedding] 任务失败 book=${task.bookId}：${outcome.error ?? '未知原因'}`);
      }

      this.tasks.delete(task.bookId);
      this.publish();
    } finally {
      task.loopActive = false;
    }
  }

  /** 推一次运行态。 */
  private publish(): void {
    this.events.onRuntime(this.describe());
  }
}
