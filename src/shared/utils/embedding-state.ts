/**
 * 书籍向量化状态的推导。
 *
 * **这个模块只给渲染层用，主进程不参与。** 状态有两个轴，来源不同：
 *
 * - **数据轴**：这本书的向量数据处于什么状况。来源是 `BookEmbedding`（落库事实）
 *   加上用户当前选中的模型——「现有向量算不算数」是相对的，所以比较必须在前端做。
 * - **运行轴**：这本书此刻有没有在被处理。只活在主进程内存里，由 `EmbeddingRuntime` 提供。
 *
 * 把两者合成一个枚举，就必然要编一个优先级顺序，而那个顺序是任意的
 * （一本书换了模型、又失败过，该显示哪个？没有客观答案）。所以这里分开算：
 * **状态只回答「用户要做什么」，原因降级成附注**。
 */
import type { BookEmbedding } from '../types/books';
import type { EmbeddingRuntime } from '../types/embedding';
import { isSameModel, type EmbeddingIdentity } from './embedding-identity';

/**
 * 界面上的向量化状态。每个值对应一句文案。
 *
 * 没有「未分片」：分片是导入时就做好的，没切出分片的书不是一个需要用户处理的状态。
 * 也没有「失败」和「索引失效」：它们的动作和「未向量化」完全一样，只是原因不同，
 * 由附注承担。
 */
export type EmbeddingState =
  /** 排队中 */
  | 'queued'
  /** 向量化中 */
  | 'running'
  /** 已暂停 */
  | 'paused'
  /** 未向量化。含从没做过、做了一半、换了模型、上次失败 */
  | 'none'
  /** 已向量化 */
  | 'done';

/**
 * 现有向量不是当前模型生成的。
 *
 * 它**不是一个状态**——动作和「未向量化」完全一样（点向量化），区别只是那句
 * 「会先删掉旧数据」。所以它降级成附注，只在文案上体现：角标用它把「未向量化」
 * 换成更准确的「待重建」。
 */
export function isStale(embedding: BookEmbedding, current: EmbeddingIdentity | null): boolean {
  if (embedding.modelFingerprint === null) return false;
  return current === null || !isSameModel(embedding.modelFingerprint, current);
}

/**
 * 数据轴：只看落库事实与当前模型。
 *
 * `total > 0` 是必需的闸——少了它，`total = 0, done = 0` 的书会因为 `0 >= 0`
 * 被算成「已向量化」。
 */
export function deriveDataState(
  embedding: BookEmbedding,
  current: EmbeddingIdentity | null
): 'none' | 'done' {
  const usable =
    embedding.total > 0 &&
    embedding.modelFingerprint !== null &&
    embedding.done >= embedding.total &&
    !isStale(embedding, current);
  return usable ? 'done' : 'none';
}

/**
 * 附注：解释「为什么是未向量化」。可能返回多条，也可能为空。
 *
 * 它们不参与分支，只影响文案——所以「换了模型」和「上次失败过」可以同时出现。
 */
export function describeEmbedding(
  embedding: BookEmbedding,
  current: EmbeddingIdentity | null
): string[] {
  const notes: string[] = [];

  if (isStale(embedding, current)) {
    notes.push(`现有 ${embedding.done} 条向量不是当前模型生成的，重新向量化会先删掉它们`);
  }
  if (embedding.lastError) {
    notes.push(`上次停在：${embedding.lastError}`);
  }
  return notes;
}

/**
 * 展示状态：**运行轴优先**。
 *
 * 优先不是因为运行态更重要，而是它更具体——一本书正在跑的时候它的 `done` 是旧的，
 * 说「未向量化」会让人以为卡住了。
 */
export function resolveEmbeddingState(
  embedding: BookEmbedding,
  bookId: string,
  current: EmbeddingIdentity | null,
  runtime: EmbeddingRuntime
): EmbeddingState {
  const task = runtime.current;
  if (task?.bookId === bookId) return task.phase;
  if (runtime.queue.includes(bookId)) return 'queued';
  return deriveDataState(embedding, current);
}

/** 这本书当前该显示的分片进度：运行中用实时值，其余只看当前模型。 */
export function resolveDisplayCounts(
  embedding: BookEmbedding,
  bookId: string,
  current: EmbeddingIdentity | null,
  runtime: EmbeddingRuntime
): { total: number; done: number } {
  const task = runtime.current;
  if (task?.bookId === bookId) {
    return { total: task.total, done: task.done };
  }
  const usable = current !== null && isSameModel(embedding.modelFingerprint, current);
  return { total: embedding.total, done: usable ? embedding.done : 0 };
}
