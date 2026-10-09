/**
 * 书籍向量化的编排层。
 *
 * 两个层次：
 *
 * - `runBookEmbedding`：跑完**一本书**。取批次 → 调接口 → 落库 → 推进度；
 *   失败就记一条原因然后停。
 * - `BookEmbeddingQueue`：把「跑一本书」串成队列，并持有暂停、取消这些运行态。
 *   它不认识 IPC——对外只有命令、`describe()` 和一个 `onRuntime` 回调。
 */
import log from 'electron-log';
import { runInTransaction } from '@main/db';
import {
  bookChunkRepo,
  bookEmbeddingRepo,
  embedIndexRepo,
  embedTaskRepo,
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

/** 每批处理的单元数。同时决定中断延迟，以及崩溃时最多丢掉多少已发出的请求。 */
const BATCH_SIZE = 32;

/** 估速率时回看的批次数。 */
const RATE_WINDOW = 5;

/** 一批的耗时样本。 */
export interface RateSample {
  /** 这一批处理了多少单元 */
  count: number;
  /** 这一批花了多少毫秒 */
  elapsedMs: number;
}

/** 速率与剩余时间估计。 */
export interface ProgressEstimate {
  /** 单元 / 秒 */
  rate: number;
  /** 预计剩余毫秒；无法估计时为 null */
  etaMs: number | null;
}

/** 运行过程中的累计进度。 */
export interface RunProgress {
  /** 这本书的分片总数，进度的分母 */
  total: number;
  /** 已经有向量的分片数 */
  done: number;
  /** 单元 / 秒，取最近几批的滑动窗口。样本不足时为 0 */
  rate: number;
  /** 预计剩余毫秒；无法估计时为 null */
  etaMs: number | null;
}

/** 一次运行的结果。 */
export interface RunOutcome {
  status: 'done' | 'paused' | 'cancelled' | 'failed';
  /** 本次实际写入向量的单元数 */
  processed: number;
  /** status 为 failed 时的原因 */
  error?: string;
}

/** 跑一本书所需的上下文。 */
export interface RunContext {
  bookId: string;
  mode: EmbedStartMode;
  model: ResolvedModel;
  /** 批次边界检查。返回非 null 表示立刻停下并给出原因 */
  checkStop: () => 'paused' | 'cancelled' | null;
  /** 每批处理完后回调一次，拿到的是这本书的累计进度 */
  onProgress: (progress: RunProgress) => void;
}

/**
 * 用滑动窗口估速率与剩余时间。
 *
 * 不用全程平均：中途被限流之后，全程平均会严重偏乐观，剩余时间一路往后跳。
 * 样本不足或耗时为零时返回 null，让界面显示「计算中」而不是一个乱跳的数字。
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
 * 取下一批待处理单元。
 *
 * 判据只有一条：**还没有向量行**。它同时覆盖了「从没做过」和「上次失败停在那里」两种情况，
 * 所以不需要任何失败明细表，也不需要游标——判据本身就是幂等的。
 *
 * 首次使用这套模型参数时向量表还不存在，没法用「排除已有向量」的查询，
 * 于是这一批直接取开头若干分片——这批做完表就建好了，之后自然走正常路径。
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
 * 落库一批向量，返回更新后的索引信息。
 *
 * 首次调用时顺带建表与注册索引，四件事在同一个事务里完成：建表、注册、写向量、累加进度。
 * 拆开写的话，崩溃会留下有记录却没有表的孤儿，或者有表却没有记录的悬空状态。
 * 表名由指纹派生，所以维度一确定就能算出来，插入 `embed_index` 时可以直接把表名填上。
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
    const target = resolved;

    const rows = batch.map((chunk, position) => ({
      chunkId: chunk.chunkId,
      sourceId: bookId,
      sourceType: 'book' as const,
      vector: encodeVector(vectors[position], target.dimension),
    }));

    // 写向量与累加进度同事务。这是全项目唯一一处「两处记同一件事」，
    // 靠原子性保证 done 不会滞后于向量行。
    embedVectorRepo.insertBatch(target, rows);
    embedTaskRepo.addDone({
      bookId,
      embedIndexId: target.id,
      total,
      delta: rows.length,
    });
    embedIndexRepo.touch(target.id, Date.now(), model.label);
    return target;
  });
}

/**
 * 跑完一本书的向量化。
 *
 * 失败的处理只有一句话：**记下原因，然后停**。不记录是哪几个分片失败的——
 * 失败的那一批本来就没有向量行，下次「继续」自然会从那里重来。
 * 这样既不需要失败明细表，也不会出现「一批 32 个里 31 个是正常的却被记成失败」。
 *
 * 两种模式共用这一个循环，差别只在开头那一次清理：`rebuild` 连当前模型的一起清，
 * `resume` 只清别的模型，当前模型下没做完的部分接着做。
 */
export async function runBookEmbedding(ctx: RunContext): Promise<RunOutcome> {
  const { bookId, mode, model, checkStop, onProgress } = ctx;

  // 一本书只允许有一份向量数据，否则同一本书会同时是「当前模型下没做」和
  // 「旧模型下做完了」，状态就说不清。每次开始之前先把别的模型留下的产物清掉。
  //
  // 重新向量化传 null（连当前模型的一起清），但**索引注册记录要留着**——清掉的只是
  // 向量行与进度行，那张表和它的注册记录本来就该复用。置空会让下面重新建一次，
  // 撞上指纹的唯一约束。
  let index = model.index;
  bookEmbeddingRepo.drop(bookId, mode === 'rebuild' ? null : (index?.id ?? null));

  const total = bookChunkRepo.countByBookId(bookId);
  if (total === 0) {
    return { status: 'done', processed: 0 };
  }

  let done = 0;
  if (index) {
    // 以向量表为准对账一次：进度行可能刚被清掉、或者与向量表对不上，这里把它拉回来。
    // 只在任务开始时做一次，不进批次循环。运行期以向量表为准，进度行只服务于总览。
    const actual = embedVectorRepo.countBySource(index.tableName, bookId);
    const row = embedTaskRepo.findByBook(bookId);
    if (!row || row.embedIndexId !== index.id || row.done !== actual) {
      embedTaskRepo.setDone({ bookId, embedIndexId: index.id, total, done: actual });
    }
    // 清掉上一次的失败原因：本次运行还没失败，界面不该继续挂着旧错误
    if (row?.lastError) {
      embedTaskRepo.clearError(bookId);
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
    // 而两种向量空间不能混用。停下来让用户决定是切回去接着做，还是对新模型重新向量化。
    const active = resolveActiveModel();
    if (active?.fingerprint !== model.fingerprint) {
      return {
        status: 'failed',
        processed,
        error: active
          ? `向量模型已变更为「${active.label}」，任务已停止。切回「${model.label}」可以接着做，或对新模型重新向量化。`
          : '向量模型配置已被移除，任务已停止。',
      };
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
      // 首次使用某个模型参数时还没有索引记录，失败无处可挂——原因只能靠返回值带出去。
      // 这是可接受的：首次就失败基本都是配置问题，用户在界面上看得到，改完再点一次即可。
      if (index) {
        embedTaskRepo.setError({
          bookId,
          embedIndexId: index.id,
          total,
          error: result.message,
        });
      }
      // 排查靠日志：库里只留一条给人看的原因，具体是哪一批分片写在日志里
      log.error(
        `[Embedding] 批次失败 book=${bookId} chunks=${batch.map(c => c.chunkId).join(',')} ${result.message}`
      );
      publish();
      return { status: 'failed', processed, error: result.message };
    }

    // 指纹没变而维度变了，说明服务端换了模型：继续写会把两种向量空间混进同一张表
    if (index && index.dimension !== result.dimension) {
      return {
        status: 'failed',
        processed,
        error: `接口返回 ${result.dimension} 维，与已建索引的 ${index.dimension} 维不一致`,
      };
    }

    index = persistBatch(bookId, model, index, batch, result.vectors, result.dimension, total);
    done += batch.length;
    processed += batch.length;
    publish();
  }
}

/** 队列对外的事件。进度推进、阶段变化、队列变化都走这一个回调。 */
export interface BookEmbeddingQueueEvents {
  onRuntime: (runtime: EmbeddingRuntime) => void;
}

/** 排队等待的任务。 */
interface QueuedTask {
  bookId: string;
  mode: EmbedStartMode;
}

/** 正在处理、或已经暂停等待恢复的任务。 */
interface RunningTask {
  bookId: string;
  mode: EmbedStartMode;
  /** 任务开始时锁定的模型身份，运行期间不再读配置 */
  model: ResolvedModel;
  phase: EmbedTaskPhase;
  /** 最近一次的进度数字 */
  progress: RunProgress;
}

/**
 * 向量化任务队列。全局串行，一次只跑一本书。
 *
 * 运行态全部留在内存，不落库——进程被杀之后没有任何需要「补偿」的东西，
 * 待处理集合是从数据库推导出来的，下次点「继续」自然接着跑。
 *
 * **它不认识 IPC。** 对外只有命令、`describe()` 和一个 `onRuntime` 回调，
 * 由调用方负责接上界面。
 */
export class BookEmbeddingQueue {
  private readonly events: BookEmbeddingQueueEvents;

  /** 正在处理或已暂停的任务；空闲时为 null */
  private running: RunningTask | null = null;

  /** 排队等待的任务，先进先出 */
  private queue: QueuedTask[] = [];

  /** 取消标志。只对当前这一轮有效，任务开始前重置 */
  private cancelled = false;

  constructor(events: BookEmbeddingQueueEvents) {
    this.events = events;
  }

  /**
   * 启动一本书的向量化。同一本书不会重复入队。
   *
   * `resume` 同时承担「开始」与「继续」：待处理集合是从数据库推导出来的，
   * 做过什么、还差什么一目了然，两者不需要区分。
   */
  start(req: EmbedStartRequest): EmbedCommandResult {
    const bookId = req.bookId?.trim();
    if (!bookId) {
      return { success: false, error: '缺少书籍 id' };
    }
    if (this.running?.bookId === bookId) {
      return { success: false, error: '这本书正在处理中' };
    }
    if (this.queue.some(task => task.bookId === bookId)) {
      return { success: false, error: '这本书已在队列中等待' };
    }
    if (!resolveActiveModel()) {
      return { success: false, error: '尚未配置或选择向量模型' };
    }

    this.queue.push({ bookId, mode: req.mode === 'rebuild' ? 'rebuild' : 'resume' });
    this.publish();
    void this.pump();
    return { success: true };
  }

  /**
   * 暂停。当前批次会先跑完——中途断开会让已经发出的请求既没落库也不算结，
   * 重启后又会被重新取出来再花一次钱。
   */
  pause(): EmbedCommandResult {
    const task = this.running;
    if (!task) {
      return { success: false, error: '当前没有正在处理的任务' };
    }
    if (task.phase === 'paused') {
      return { success: false, error: '任务已经处于暂停状态' };
    }
    task.phase = 'paused';
    this.publish();
    return { success: true };
  }

  /** 从暂停处继续。已经写好的向量不重做。 */
  resume(): EmbedCommandResult {
    const task = this.running;
    if (task?.phase !== 'paused') {
      return { success: false, error: '当前没有暂停的任务' };
    }
    task.phase = 'running';
    this.publish();

    // rebuild 的清理在暂停之前就做完了，接着跑等同于「继续」
    task.mode = 'resume';
    void this.execute(task);
    return { success: true };
  }

  /** 取消当前任务。已经写好的向量保留——不删已经花过钱的产物。 */
  cancel(): EmbedCommandResult {
    const task = this.running;
    if (!task) {
      return { success: false, error: '当前没有正在处理的任务' };
    }
    if (task.phase === 'paused') {
      // 暂停时循环已经退出，没有任何人在检查取消标志，只能直接收尾
      this.running = null;
      this.publish();
      void this.pump();
      return { success: true };
    }
    this.cancelled = true;
    return { success: true };
  }

  /** 当前的运行态，供渲染层刷新后恢复。 */
  describe(): EmbeddingRuntime {
    const task = this.running;
    return {
      current: task
        ? {
            bookId: task.bookId,
            phase: task.phase,
            total: task.progress.total,
            done: task.progress.done,
            rate: task.progress.rate,
            etaMs: task.progress.etaMs,
          }
        : null,
      queue: this.queue.map(item => item.bookId),
    };
  }

  /** 队列推进：一次只跑一本书。暂停中的任务仍然占着 running，所以这里自然不前进。 */
  private async pump(): Promise<void> {
    if (this.running) return;

    const next = this.queue.shift();
    if (!next) return;

    const model = resolveActiveModel();
    if (!model) {
      // 排队期间配置被删了：这个任务跑不了，直接丢掉并让界面看到队列变短
      log.warn(`[Embedding] 排队中的任务被丢弃：没有可用的向量模型 book=${next.bookId}`);
      this.publish();
      void this.pump();
      return;
    }

    const task: RunningTask = {
      bookId: next.bookId,
      mode: next.mode,
      model,
      phase: 'running',
      progress: { total: 0, done: 0, rate: 0, etaMs: null },
    };
    this.running = task;
    this.cancelled = false;
    this.publish();
    await this.execute(task);
  }

  /** 跑当前任务，并处理它的终结。 */
  private async execute(task: RunningTask): Promise<void> {
    const outcome = await runBookEmbedding({
      bookId: task.bookId,
      mode: task.mode,
      model: task.model,
      checkStop: () => {
        if (this.cancelled) return 'cancelled';
        return task.phase === 'paused' ? 'paused' : null;
      },
      onProgress: progress => {
        task.progress = progress;
        // 阶段也在这里一起推：暂停请求是在批次中途发出的，那一批跑完后还会再推一次进度。
        // 若这里只推进度、状态另算，后推的那条会把暂停覆盖掉，界面永远停在「向量化中」。
        this.publish();
      },
    });

    if (outcome.status === 'paused') {
      // 保留 running，等 resume() 接着跑
      return;
    }
    if (outcome.status === 'failed') {
      // 失败原因已经落进 embed_task.last_error，由书籍列表带给界面；
      // 这里只留一条日志，方便排查是哪本书、停在哪一步
      log.warn(`[Embedding] 任务失败 book=${task.bookId}：${outcome.error ?? '未知原因'}`);
    }

    this.running = null;
    this.cancelled = false;
    this.publish();
    void this.pump();
  }

  /** 推一次运行态。 */
  private publish(): void {
    this.events.onRuntime(this.describe());
  }
}
