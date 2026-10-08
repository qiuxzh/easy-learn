import { cut_for_search } from 'jieba-wasm';
import type { BookChunkRow } from '../db/schema';
import { bookChunkRepo } from '../db/repo';

const DEFAULT_BM25_K1 = 1.5;
const DEFAULT_BM25_B = 0.75;

const CHINESE_STOP_WORDS = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
  '它',
  '们',
  '那',
  '些',
  '什么',
  '怎么',
  '这个',
  '那个',
  '可以',
  '没',
  '把',
  '被',
  '让',
  '给',
  '从',
  '向',
  '对',
  '为',
  '以',
  '与',
  '而',
  '但',
  '或',
  '如果',
  '因为',
  '所以',
  '但是',
  '而且',
  '虽然',
  '尽管',
  '还是',
  '已经',
  '正在',
  '将',
]);

const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'this',
  'but',
  'they',
  'have',
  'had',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'how',
  'not',
  'no',
  'nor',
  'so',
  'too',
  'very',
  'can',
  'could',
  'may',
  'might',
  'shall',
  'should',
  'would',
  'do',
  'does',
  'did',
  'been',
  'being',
]);

const STOP_WORDS = new Set([...CHINESE_STOP_WORDS, ...ENGLISH_STOP_WORDS]);

interface Posting {
  chunkId: string;
  termFrequency: number;
}

interface TermIndexEntry {
  documentFrequency: number;
  inverseDocumentFrequency: number;
  postings: Posting[];
}

interface ChunkMeta {
  tokenLength: number;
}

interface BookBm25Index {
  chunksById: Map<string, BookChunkRow>;
  chunkMetaById: Map<string, ChunkMeta>;
  terms: Map<string, TermIndexEntry>;
  totalChunks: number;
  averageChunkLength: number;
}

export interface BookBm25SearchResult {
  chunk: BookChunkRow;
  score: number;
}

/**
 * 按书维护 BM25 索引。
 * Chunk 只在首次检索该书时从 SQLite 加载一次；索引没有 TTL，直到书籍删除或显式失效才释放。
 */
export class BookBm25SearchService {
  private readonly indexes = new Map<string, BookBm25Index>();
  private readonly buildingIndexes = new Map<string, Promise<BookBm25Index>>();

  /** 执行指定书籍的 BM25 检索。 */
  async search(bookId: string, query: string, topK: number): Promise<BookBm25SearchResult[]> {
    const queryTerms = tokenizeBookQuery(query);
    if (queryTerms.length === 0) return [];

    const index = await this.getOrBuildIndex(bookId);
    return searchBookBm25Index(index, queryTerms, topK);
  }

  /** 在书籍删除或 Chunk 重建后丢弃对应的内存索引。 */
  invalidateBook(bookId: string): void {
    this.indexes.delete(bookId);
    this.buildingIndexes.delete(bookId);
  }

  /** 读取数据库中的 Chunk，并将同一本书的并发首次检索合并为一次建索引任务。 */
  private async getOrBuildIndex(bookId: string): Promise<BookBm25Index> {
    const cached = this.indexes.get(bookId);
    if (cached) return cached;

    const building = this.buildingIndexes.get(bookId);
    if (building) return building;

    const task = Promise.resolve().then(() => {
      const chunks = bookChunkRepo.findByBookId(bookId);
      const index = buildBookBm25Index(chunks);
      this.indexes.set(bookId, index);
      return index;
    });

    this.buildingIndexes.set(bookId, task);
    try {
      return await task;
    } finally {
      this.buildingIndexes.delete(bookId);
    }
  }
}

/** 将书籍正文转换为 BM25 token，保留词频以支持词频打分。 */
export function tokenizeBookContent(text: string): string[] {
  return tokenize(text);
}

/** 将用户查询转换为去重 token，避免重复输入同一关键词人为抬高分数。 */
export function tokenizeBookQuery(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/** 基于书籍 Chunk 构建倒排索引和文档长度统计。 */
export function buildBookBm25Index(chunks: BookChunkRow[]): BookBm25Index {
  const chunksById = new Map<string, BookChunkRow>();
  const chunkMetaById = new Map<string, ChunkMeta>();
  const terms = new Map<string, TermIndexEntry>();
  let totalTokenLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenizeBookContent(chunk.content);
    const frequencies = getTokenFrequencies(tokens);

    chunksById.set(chunk.id, chunk);
    chunkMetaById.set(chunk.id, { tokenLength: tokens.length });
    totalTokenLength += tokens.length;

    for (const [term, termFrequency] of frequencies) {
      const entry = terms.get(term) ?? {
        documentFrequency: 0,
        inverseDocumentFrequency: 0,
        postings: [],
      };
      entry.postings.push({ chunkId: chunk.id, termFrequency });
      entry.documentFrequency += 1;
      terms.set(term, entry);
    }
  }

  const totalChunks = chunks.length;
  for (const entry of terms.values()) {
    entry.inverseDocumentFrequency = Math.log(
      (totalChunks - entry.documentFrequency + 0.5) / (entry.documentFrequency + 0.5) + 1
    );
  }

  return {
    chunksById,
    chunkMetaById,
    terms,
    totalChunks,
    averageChunkLength: totalChunks > 0 ? totalTokenLength / totalChunks : 0,
  };
}

/** 使用倒排索引计算 BM25 分数，并按分数和书中位置稳定排序。 */
export function searchBookBm25Index(
  index: BookBm25Index,
  queryTerms: string[],
  topK: number
): BookBm25SearchResult[] {
  if (queryTerms.length === 0 || index.totalChunks === 0 || index.averageChunkLength === 0) {
    return [];
  }

  const scores = new Map<string, number>();
  for (const term of queryTerms) {
    const entry = index.terms.get(term);
    if (!entry) continue;

    for (const posting of entry.postings) {
      const chunkMeta = index.chunkMetaById.get(posting.chunkId);
      if (!chunkMeta) continue;

      const lengthNormalization =
        1 - DEFAULT_BM25_B + DEFAULT_BM25_B * (chunkMeta.tokenLength / index.averageChunkLength);
      const saturatedTermFrequency =
        (posting.termFrequency * (DEFAULT_BM25_K1 + 1)) /
        (posting.termFrequency + DEFAULT_BM25_K1 * lengthNormalization);
      const termScore = entry.inverseDocumentFrequency * saturatedTermFrequency;

      scores.set(posting.chunkId, (scores.get(posting.chunkId) ?? 0) + termScore);
    }
  }

  return [...scores.entries()]
    .flatMap(([chunkId, score]) => {
      const chunk = index.chunksById.get(chunkId);
      return chunk ? [{ chunk, score }] : [];
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.chunk.segmentIndex !== right.chunk.segmentIndex) {
        return left.chunk.segmentIndex - right.chunk.segmentIndex;
      }
      return left.chunk.chunkIndex - right.chunk.chunkIndex;
    })
    .slice(0, topK);
}

/**
 * 使用 jieba-wasm 的搜索模式完成中文分词。
 * 搜索模式会同时保留完整词和适合召回的子词；正文与查询共用同一逻辑以保证倒排索引可匹配。
 */
function tokenize(text: string): string[] {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return [];

  return cut_for_search(normalizedText, true).map(normalizeToken).filter(isSearchableToken);
}

/** 统一 token 的大小写、全半角和两端空白。 */
function normalizeToken(token: string): string {
  return token.toLowerCase().normalize('NFKC').trim();
}

/** 过滤停用词、空白和不含文字或数字的标点 token。 */
function isSearchableToken(token: string): boolean {
  return Boolean(token) && !STOP_WORDS.has(token) && /[\p{L}\p{N}]/u.test(token);
}

/** 统一输入文本的大小写、全半角和空白，减少正文与查询之间的形式差异。 */
function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** 将 token 数组转换为词频表，供倒排索引记录每个 Chunk 的词频。 */
function getTokenFrequencies(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

export const bookBm25SearchService = new BookBm25SearchService();
