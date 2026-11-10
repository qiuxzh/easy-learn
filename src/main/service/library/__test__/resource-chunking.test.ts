import { describe, expect, it } from 'vitest';
import { createPdfSource } from '@main/service/etl/chunking';
import { chunkResource } from '../resource-chunking';

/** 造一页足够长的正文，低于单页阈值会被 PDF 文档源整页跳过。 */
function pageText(prefix: string): string {
  return `${prefix}${'内容'.repeat(60)}`;
}

describe('chunkResource', () => {
  it('按页产分片，定位串保留页号', async () => {
    const source = createPdfSource({
      pageCount: 2,
      pages: [
        { page: 1, text: pageText('第一页') },
        { page: 2, text: pageText('第二页') },
      ],
    });

    const drafts = await chunkResource(source);

    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0].locator).toBe('pdf:1');
    expect(JSON.parse(drafts[0].meta ?? '{}')).toMatchObject({ segmentId: '1' });
  });

  it('没有页时返回空数组', async () => {
    const source = createPdfSource({ pageCount: 0, pages: [] });

    await expect(chunkResource(source)).resolves.toEqual([]);
  });
});
