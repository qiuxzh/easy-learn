import { cut_for_search } from 'jieba-wasm';
import { STOP_WORDS } from './stop-words';

/**
 * 分词：把正文与查询切成可比较的 token。
 *
 * 正文与查询**必须共用这一份实现**：任何一边单独改了归一化或停用词规则，
 * 倒排索引就会匹配不上，而且不会报错，只是召回悄悄变差。
 */

/** 把正文转成 token，保留重复以支持词频打分。 */
export function tokenizeContent(text: string): string[] {
  return tokenize(text);
}

/** 把查询转成去重 token，避免重复输入同一关键词人为抬高分数。 */
export function tokenizeQuery(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/**
 * 使用 jieba-wasm 的搜索模式完成中文分词。
 * 搜索模式会同时保留完整词和适合召回的子词，因此「人工智能」既能被整词命中，也能被「智能」命中。
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
