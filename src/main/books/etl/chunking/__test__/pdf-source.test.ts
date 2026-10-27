/**
 * PDF 文档源。
 *
 * 它的产物直接进检索：分片是否落在正确的页、缺文本层的页是否被跳过，
 * 错了不会有任何报错，只会让命中跳错页或者搜不到。所以这里逐条钉住。
 */
import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../chunk-document';
import { createPdfSource } from '../pdf-source';
import { PDF_PAGE_TEXT_MIN_CHARS, type PdfTextReport } from '../../pdf/pdf-pages';

function reportOf(texts: string[]): PdfTextReport {
  return {
    pageCount: texts.length,
    pages: texts.map((text, index) => ({ page: index + 1, text })),
  };
}

describe('createPdfSource', () => {
  it('一页一段，页号从 1 开始，兜底定位是 pdf:<页号>', async () => {
    const source = createPdfSource(reportOf(['甲'.repeat(100), '乙'.repeat(100)]));
    const segments = await source.listSegments();

    expect(segments.map(segment => segment.index)).toEqual([0, 1]);
    expect(segments.map(segment => segment.id)).toEqual(['1', '2']);
    expect(segments.map(segment => segment.fallbackLocator)).toEqual(['pdf:1', 'pdf:2']);
  });

  it('缺文本层的页不产出文本单元', async () => {
    const source = createPdfSource(reportOf(['字'.repeat(PDF_PAGE_TEXT_MIN_CHARS - 1)]));
    const [segment] = await source.listSegments();
    expect(await source.loadTextUnits(segment)).toEqual([]);
  });

  it('版面换行压成空格，不变成段落分隔', async () => {
    const source = createPdfSource(reportOf([`第一行的内容\n第二行的内容`.repeat(20)]));
    const [segment] = await source.listSegments();
    const units = await source.loadTextUnits(segment);
    expect(units.some(unit => unit.value === '\n')).toBe(false);
    expect(units.some(unit => unit.value === ' ' && unit.start === null)).toBe(true);
  });

  it('分片只落在有文本的页上，定位串是页级', async () => {
    const source = createPdfSource(
      reportOf(['第一章 绪论。'.repeat(100), '只有页码的扫描页', '第二章 方法。'.repeat(100)])
    );
    const drafts = await chunkDocument(source);

    expect(drafts.length).toBeGreaterThan(0);
    // 第 2 页低于阈值，不应出现它的分片
    expect(drafts.every(draft => draft.segmentId === '1' || draft.segmentId === '3')).toBe(true);
    expect(drafts.every(draft => draft.locatorStart.startsWith('pdf:'))).toBe(true);
    expect(drafts.every(draft => draft.locatorEnd.startsWith('pdf:'))).toBe(true);
  });

  it('锚点不是页号时编码不出来，交给编排层降级', async () => {
    const source = createPdfSource(reportOf(['字'.repeat(100)]));
    const [segment] = await source.listSegments();
    expect(source.encodeLocator(segment, { page: 1 })).toBe('pdf:1');
    expect(source.encodeLocator(segment, { page: 'x' })).toBeNull();
    expect(source.encodeLocator(segment, null)).toBeNull();
  });
});
