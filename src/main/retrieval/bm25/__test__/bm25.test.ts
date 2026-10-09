import { describe, expect, it, vi } from 'vitest';
import type { RetrievalDocument } from '../../types';
import { buildBm25Index, searchBm25Index } from '../core';
import { Bm25Retriever } from '../retriever';
import { tokenizeQuery } from '../tokenizer';

/** 检索层只认 {id, content}，测试数据不需要带任何领域字段。 */
function createDocument(id: string, content: string): RetrievalDocument {
  return { id, content };
}

describe('BM25 检索', () => {
  it('会使用 Jieba 搜索模式生成完整中文词、子词和英文 token', () => {
    const tokens = tokenizeQuery('人工智能 AI');

    expect(tokens).toEqual(expect.arrayContaining(['人工', '智能', '人工智能', 'ai']));
  });

  it('会将关键词更集中的文档排在前面', () => {
    const documents = [
      createDocument('doc-1', '人工智能正在改变学习方法，人工智能可以辅助学习。'),
      createDocument('doc-2', '学习需要长期复盘，才能逐步巩固知识。'),
      createDocument('doc-3', '工作流优化可以提升效率。'),
    ];
    const index = buildBm25Index(documents);
    const results = searchBm25Index(index, tokenizeQuery('人工智能学习'), 3);

    expect(results).toHaveLength(2);
    expect(results[0].document.id).toBe('doc-1');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('同分时按输入顺序稳定排序', () => {
    // 两篇内容完全相同，分数必然相同，此时顺序应当与输入一致
    const documents = [createDocument('doc-1', '检索排序'), createDocument('doc-2', '检索排序')];
    const index = buildBm25Index(documents);
    const results = searchBm25Index(index, tokenizeQuery('检索'), 2);

    expect(results.map(hit => hit.document.id)).toEqual(['doc-1', 'doc-2']);
  });

  it('首次检索只加载一次，失效后才重新加载', async () => {
    const load = vi.fn(() => [createDocument('doc-1', 'BM25 用于关键词检索。')]);
    const retriever = new Bm25Retriever({ load });

    await retriever.search('key-1', 'BM25', 5);
    await retriever.search('key-1', '关键词', 5);
    expect(load).toHaveBeenCalledTimes(1);

    retriever.invalidate('key-1');
    await retriever.search('key-1', '检索', 5);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('同一 key 的并发首次检索只加载一次', async () => {
    const load = vi.fn(async () => [createDocument('doc-1', '并发检索')]);
    const retriever = new Bm25Retriever({ load });

    await Promise.all([retriever.search('key-1', '并发', 5), retriever.search('key-1', '检索', 5)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('查询词一个都没命中时返回空结果', () => {
    const index = buildBm25Index([createDocument('doc-1', '工作流优化')]);

    expect(searchBm25Index(index, tokenizeQuery('量子力学'), 5)).toEqual([]);
  });
});
