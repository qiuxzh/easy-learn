/**
 * 书籍向量化状态的推导。
 *
 * 数据轴两端共用，运行轴只给渲染层。数据轴判断这本书的向量数据是否算数，来源是
 * `BookEmbedding` 落库事实与用户当前选中的模型；比较必须只有一份实现，保证界面显示
 * 「已向量化」与检索工具可用永远等价。运行轴只看这本书此刻有没有在被处理，只活在
 * 主进程内存里，由 `EmbeddingRuntime` 提供。
 *
 * 两者不合成一个枚举：合成必然要编一个优先级顺序，而那个顺序是任意的。所以状态只
 * 回答用户要做什么，原因降级成附注。
 */
import type { BookEmbedding, BookStageInfo } from '../types/books';
import type { EmbeddingRuntime, EmbeddingState } from '../types/embedding';
import { isSameModel, type EmbeddingIdentity } from './embedding-identity';

/**
 * 把「向量阶段」的进度投影成向量化信息。
 *
 * 界面拿到的是 `BookDoc.stages`（阶段形状），而这里的推导、以及主进程的检索判断
 * 都建立在 `BookEmbedding` 上。两者字段一一对应，所以转换只有这一处。
 *
 * 阶段不存在、或 `total` / `done` 为空时按 0 处理：此时这本书本来就不具备向量，
 * 显示成「未向量化」与事实一致。
 */
export function toEmbedding(stage: BookStageInfo | undefined): BookEmbedding {
  return {
    total: stage?.total ?? 0,
    done: stage?.done ?? 0,
    modelFingerprint: stage?.identity ?? null,
    lastError: stage?.lastError ?? null,
  };
}

/**
 * 现有向量不是当前模型生成的。
 *
 * 它不是一个状态：动作和「未向量化」一样（点向量化），区别只是文案要说明会先删旧数据。
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
 * 展示状态：运行轴优先。
 *
 * 优先不是因为运行态更重要，而是它更具体——一本书正在跑的时候它的 `done` 是旧的，
 * 说「未向量化」会让人以为卡住了。
 *
 * 运行态按书查，不看别的书：多本书可以同时在跑，一本书自己的状态与其它任务无关。
 */
export function resolveEmbeddingState(
  embedding: BookEmbedding,
  bookId: string,
  current: EmbeddingIdentity | null,
  runtime: EmbeddingRuntime
): EmbeddingState {
  const task = runtime.tasks.find(item => item.bookId === bookId);
  if (task) return task.phase;
  return deriveDataState(embedding, current);
}

/** 这本书当前该显示的分片进度：运行中用实时值，其余只看当前模型。 */
export function resolveDisplayCounts(
  embedding: BookEmbedding,
  bookId: string,
  current: EmbeddingIdentity | null,
  runtime: EmbeddingRuntime
): { total: number; done: number } {
  const task = runtime.tasks.find(item => item.bookId === bookId);
  if (task) {
    return { total: task.total, done: task.done };
  }
  const usable = current !== null && isSameModel(embedding.modelFingerprint, current);
  return { total: embedding.total, done: usable ? embedding.done : 0 };
}
