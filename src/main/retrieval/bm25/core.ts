import type { RetrievalDocument } from '../types';
import type { Bm25Hit, Bm25Index, DocumentMeta, TermIndexEntry } from './types';
import { tokenizeContent } from './tokenizer';

/**
 * BM25 打分核心：**纯函数、无状态、不碰数据库**。
 *
 * 建索引与检索分开导出，是为了让算法能被单独测试；缓存与失效不在这里，
 * 见 `retriever.ts`。
 */

/** 词频饱和参数：越大，词频继续增长带来的收益越平缓。 */
const DEFAULT_BM25_K1 = 1.5;

/** 长度归一化强度：0 表示不归一化，1 表示完全按文档长度归一化。 */
const DEFAULT_BM25_B = 0.75;

/**
 * 基于一批文档构建倒排索引与长度统计。
 *
 * **输入顺序即同分兜底的顺序**：调用方需按期望的展示顺序传入（书籍场景是阅读顺序），
 * 索引把下标记进 `DocumentMeta.order`，检索时据此稳定排序。
 */
export function buildBm25Index<T extends RetrievalDocument>(documents: T[]): Bm25Index<T> {
  const documentsById = new Map<string, T>();
  const documentMetaById = new Map<string, DocumentMeta>();
  const terms = new Map<string, TermIndexEntry>();
  let totalTokenLength = 0;

  for (let order = 0; order < documents.length; order += 1) {
    const document = documents[order];
    const tokens = tokenizeContent(document.content);
    const frequencies = getTokenFrequencies(tokens);

    documentsById.set(document.id, document);
    documentMetaById.set(document.id, { tokenLength: tokens.length, order });
    totalTokenLength += tokens.length;

    for (const [term, termFrequency] of frequencies) {
      const entry = terms.get(term) ?? {
        documentFrequency: 0,
        inverseDocumentFrequency: 0,
        postings: [],
      };
      entry.postings.push({ documentId: document.id, termFrequency });
      entry.documentFrequency += 1;
      terms.set(term, entry);
    }
  }

  const totalDocuments = documents.length;
  for (const entry of terms.values()) {
    entry.inverseDocumentFrequency = Math.log(
      (totalDocuments - entry.documentFrequency + 0.5) / (entry.documentFrequency + 0.5) + 1
    );
  }

  return {
    documentsById,
    documentMetaById,
    terms,
    totalDocuments,
    averageDocumentLength: totalDocuments > 0 ? totalTokenLength / totalDocuments : 0,
  };
}

/**
 * 用倒排索引计算 BM25 分数，按分数降序、同分按输入顺序稳定排序。
 *
 * 只返回至少命中一个查询词的文档；查询词一个都不在索引里时返回空数组。
 */
export function searchBm25Index<T extends RetrievalDocument>(
  index: Bm25Index<T>,
  queryTerms: string[],
  topK: number
): Bm25Hit<T>[] {
  if (queryTerms.length === 0 || index.totalDocuments === 0 || index.averageDocumentLength === 0) {
    return [];
  }

  const scores = new Map<string, number>();
  for (const term of queryTerms) {
    const entry = index.terms.get(term);
    if (!entry) continue;

    for (const posting of entry.postings) {
      const meta = index.documentMetaById.get(posting.documentId);
      if (!meta) continue;

      const lengthNormalization =
        1 - DEFAULT_BM25_B + DEFAULT_BM25_B * (meta.tokenLength / index.averageDocumentLength);
      const saturatedTermFrequency =
        (posting.termFrequency * (DEFAULT_BM25_K1 + 1)) /
        (posting.termFrequency + DEFAULT_BM25_K1 * lengthNormalization);
      const termScore = entry.inverseDocumentFrequency * saturatedTermFrequency;

      scores.set(posting.documentId, (scores.get(posting.documentId) ?? 0) + termScore);
    }
  }

  return [...scores.entries()]
    .flatMap(([documentId, score]) => {
      const document = index.documentsById.get(documentId);
      const meta = index.documentMetaById.get(documentId);
      return document && meta ? [{ document, score, order: meta.order }] : [];
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.order - right.order;
    })
    .slice(0, topK)
    .map(({ document, score }) => ({ document, score }));
}

/** 把 token 数组压成词频表，供倒排表记录每个文档的词频。 */
function getTokenFrequencies(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}
