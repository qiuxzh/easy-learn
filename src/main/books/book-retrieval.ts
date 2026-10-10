/**
 * 书籍检索的装配层。
 *
 * 两条链路的算法都不在这里：BM25 的在 `@main/retrieval/bm25`，
 * 向量的在 `@main/db/vector-extension` 加载的 sqlite-vector 扩展里。
 */
import log from 'electron-log';
import { bookChunkRepo, bookEmbeddingRepo, embedVectorRepo } from '@main/db/repo';
import type { BookChunkRow, VectorSearchHit } from '@main/db/repo';
import { assertVectorExtensionReady } from '@main/db/vector-extension';
import { Bm25Retriever } from '@main/retrieval/bm25/retriever';
import type { BookEmbedding } from '@shared/types/books';
import type { EmbeddingIdentity } from '@shared/utils/embedding-identity';
import { deriveDataState, describeEmbedding, isStale } from '@shared/utils/embedding-state';
import { embedTexts, resolveActiveModel } from './etl/embedding';
import type { ResolvedModel } from './etl/embedding';

/** 查询向量化的超时与重试次数。这是用户等着的交互路径，比批量向量化短得多。 */
const QUERY_EMBED_TIMEOUT_MS = 8_000;
const QUERY_EMBED_MAX_ATTEMPTS = 2;

/**
 * 一条检索命中：分片 + 分数。
 *
 * 两个检索器同形，分数方向也一致（越大越相关），但**尺度不可比**——BM25 无上界，
 * 向量那边是余弦相似度（[-1, 1]）。融合要用排名，不要比分数。
 */
export interface BookSearchHit {
  chunk: BookChunkRow;
  score: number;
}

/**
 * 一次向量检索的结果。预期内的失败用返回值表达，不抛异常。
 *
 * 失败只给一句人话：唯一的消费方是工具，它把这句话转给模型，模型照着做即可；
 * 再挂一个机器可读的原因码没有消费者，只是多一份要同步的东西。
 */
export type BookVectorResult = { ok: true; hits: BookSearchHit[] } | { ok: false; message: string };

/**
 * `BookChunkRow` 结构上就满足 `RetrievalDocument`（`@main/retrieval/types`），
 * 所以加载器直接返回数据库行；`findByBookId` 按阅读顺序返回，正是索引同分排序要的兜底顺序。
 */
const bm25Retriever = new Bm25Retriever<BookChunkRow>({
  load: bookId => bookChunkRepo.findByBookId(bookId),
});

/** 在指定书籍中做 BM25 检索。 */
export async function searchBookBm25(
  bookId: string,
  query: string,
  topK: number
): Promise<BookSearchHit[]> {
  const hits = await bm25Retriever.search(bookId, query, topK);
  return hits.map(hit => ({ chunk: hit.document, score: hit.score }));
}

/**
 * 丢弃某本书的内存检索索引。
 *
 * 删除书籍、重新分片、重新导入之后调用。向量在库里，没有内存索引可丢。
 */
export function invalidateBookRetrieval(bookId: string): void {
  bm25Retriever.invalidate(bookId);
}

/** 在指定书籍中做向量检索。只把预期内的失败转成返回值，其他异常原样抛出。 */
export async function searchBookVector(
  bookId: string,
  query: string,
  topK: number
): Promise<BookVectorResult> {
  const model = resolveActiveModel();
  if (!model) {
    return { ok: false, message: '尚未配置或选择向量模型，请先在设置页配置 embeddings 接口' };
  }

  const index = model.index;
  if (index === null) {
    return {
      ok: false,
      message: `向量模型「${model.label}」还没有任何已完成的向量索引，请先在书库页向量化这本书`,
    };
  }

  const embedding = bookEmbeddingRepo.load(bookId);
  const identity: EmbeddingIdentity = { endpoint: model.endpoint, modelId: model.modelId };

  // 判定与渲染层共用 `deriveDataState`（@shared/utils/embedding-state），保证界面与工具结论一致；
  // 它把「没做过」和「已过期」都归成 none，具体措辞由 describeNotSearchable 再区分。
  if (deriveDataState(embedding, identity) !== 'done') {
    return { ok: false, message: describeNotSearchable(embedding, identity, model.label) };
  }

  try {
    assertVectorExtensionReady();
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }

  let queryVector: number[];
  try {
    queryVector = await embedQuery(model, query);
  } catch (error) {
    return { ok: false, message: `查询向量化失败：${describeError(error)}` };
  }

  // 指纹没变而维度变了，说明服务端换了模型。先挡住，免得扩展报「向量长度不符」这种
  // 对模型没有意义的错。
  if (queryVector.length !== index.dimension) {
    return {
      ok: false,
      message: `接口返回 ${queryVector.length} 维，与索引的 ${index.dimension} 维不一致`,
    };
  }

  const hits = embedVectorRepo.searchBySource(index, bookId, queryVector, topK);
  return { ok: true, hits: hydrateVectorHits(hits) };
}

/** 把查询文本交给当前模型向量化。失败抛出，由调用方翻成 `embed_failed`。 */
async function embedQuery(model: ResolvedModel, text: string): Promise<number[]> {
  const result = await embedTexts(
    { endpoint: model.endpoint, modelId: model.modelId, apiKey: model.apiKey },
    [text],
    { timeoutMs: QUERY_EMBED_TIMEOUT_MS, maxAttempts: QUERY_EMBED_MAX_ATTEMPTS }
  );
  if (!result.ok) throw new Error(result.message);
  return result.vectors[0];
}

/** 把命中的文档标识回查成完整分片行，并把距离换算成分数，保持分数降序。 */
function hydrateVectorHits(hits: VectorSearchHit[]): BookSearchHit[] {
  if (hits.length === 0) return [];

  // 批量查一次再按 id 回填：findByIds 的返回顺序不保证与传入一致
  const chunksById = new Map(
    bookChunkRepo.findByIds(hits.map(hit => hit.documentId)).map(chunk => [chunk.id, chunk])
  );

  return hits.flatMap(hit => {
    const chunk = chunksById.get(hit.documentId);
    if (!chunk) {
      // 重新分片的中间窗口会短暂留下这种行，丢掉比报错好
      log.warn(`[BookRetrieval] 向量命中了一个不存在的分片：${hit.documentId}`);
      return [];
    }
    return [{ chunk, score: vectorScore(hit.distance) }];
  });
}

/**
 * 向量距离 → 相似度分数（越大越相关）。
 *
 * 换算成立的前提是距离度量为 COSINE，即 `@shared/utils/embedding-identity` 里的
 * `VECTOR_DISTANCE` 常量；本项目固定只用它。
 */
function vectorScore(distance: number): number {
  return 1 - distance;
}

/** 拼一句「这本书为什么不能检索」的原因。附注推导与渲染层共用同一份。 */
function describeNotSearchable(
  embedding: BookEmbedding,
  identity: EmbeddingIdentity,
  modelLabel: string
): string {
  if (embedding.total === 0) {
    return '这本书还没有正文分片，无法向量化';
  }
  if (isStale(embedding, identity)) {
    return `这本书的向量不是当前模型「${modelLabel}」生成的（已过期），请到书库页重新向量化`;
  }

  const notes = describeEmbedding(embedding, identity);
  const detail = notes.length > 0 ? `：${notes.join('；')}` : '';
  return `这本书的向量化未完成（${embedding.done}/${embedding.total}）${detail}，请到书库页继续向量化`;
}

/** 把异常压成一句人话。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
