import { describe, expect, it, vi } from 'vitest';
import type { BookChunkRow } from '../../db/schema';

const { findByBookId } = vi.hoisted(() => ({ findByBookId: vi.fn() }));

vi.mock('../../db/repo', () => ({
  bookChunkRepo: { findByBookId },
}));

import {
  BookBm25SearchService,
  buildBookBm25Index,
  searchBookBm25Index,
  tokenizeBookQuery,
} from '../book-bm25';

/** 创建满足 Chunk 表字段要求的检索测试数据。 */
function createChunk(id: string, content: string, chunkIndex: number): BookChunkRow {
  return {
    id,
    bookId: 'book-1',
    sectionIndex: 0,
    sectionId: 'chapter-1.xhtml',
    href: 'chapter-1.xhtml',
    chunkIndex,
    content,
    startCfi: `epubcfi(/6/2[chapter-1]!/4/2/1:${chunkIndex})`,
    endCfi: `epubcfi(/6/2[chapter-1]!/4/2/1:${chunkIndex + content.length})`,
  };
}

describe('book BM25', () => {
  it('会使用 Jieba 搜索模式生成完整中文词、子词和英文 token', () => {
    const tokens = tokenizeBookQuery('人工智能 AI');

    expect(tokens).toEqual(expect.arrayContaining(['人工', '智能', '人工智能', 'ai']));
  });

  it('会将关键词更集中的 Chunk 排在前面', () => {
    const chunks = [
      createChunk('chunk-1', '人工智能正在改变学习方法，人工智能可以辅助学习。', 0),
      createChunk('chunk-2', '学习需要长期复盘，才能逐步巩固知识。', 1),
      createChunk('chunk-3', '工作流优化可以提升效率。', 2),
    ];
    const index = buildBookBm25Index(chunks);
    const results = searchBookBm25Index(index, tokenizeBookQuery('人工智能学习'), 3);

    expect(results).toHaveLength(2);
    expect(results[0].chunk.id).toBe('chunk-1');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('首次检索从数据库加载一次，失效后才重新加载', async () => {
    findByBookId.mockReturnValue([createChunk('chunk-1', 'BM25 用于关键词检索。', 0)]);
    const service = new BookBm25SearchService();

    await service.search('book-1', 'BM25', 5);
    await service.search('book-1', '关键词', 5);
    expect(findByBookId).toHaveBeenCalledTimes(1);

    service.invalidateBook('book-1');
    await service.search('book-1', '检索', 5);
    expect(findByBookId).toHaveBeenCalledTimes(2);
  });
});
