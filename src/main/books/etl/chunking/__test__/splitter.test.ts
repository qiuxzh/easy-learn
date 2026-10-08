import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_OPTIONS,
  buildChunkContent,
  findRangeAnchors,
  splitTextUnits,
} from '../splitter';
import type { TextUnit } from '../types';

/** 把字符串按码点转成带序号锚点的文本单元，用于纯切分测试。 */
function createUnits(text: string): TextUnit[] {
  return [...text].map((value, index) => ({
    value,
    start: index,
    end: index + 1,
  }));
}

/** 生成带稳定句末边界的长正文。 */
function createLongContent(): string {
  return Array.from(
    { length: 80 },
    (_, index) => `第${index + 1}段包含用于验证重叠切分的正文内容。`
  ).join('');
}

/** 按切分结果取出各分片正文。 */
function buildChunks(units: TextUnit[]): string[] {
  return splitTextUnits(units, DEFAULT_CHUNK_OPTIONS).map(range => buildChunkContent(units, range));
}

describe('splitTextUnits', () => {
  it('会为长正文生成符合长度要求且带重叠的分片', () => {
    const units = createUnits(createLongContent());
    const chunks = buildChunks(units);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.slice(0, -1).every(chunk => chunk.length >= 300)).toBe(true);
    expect(chunks.every(chunk => chunk.length <= 800)).toBe(true);
    expect(chunks[0].slice(-120)).toBe(chunks[1].slice(0, 120));
  });

  it('短正文只生成一个覆盖全部单元的分片', () => {
    const units = createUnits('这是一段不足三百字的简短正文。');

    expect(splitTextUnits(units, DEFAULT_CHUNK_OPTIONS)).toEqual([
      { startIndex: 0, endIndex: units.length },
    ]);
  });

  it('会优先在目标长度前的句末边界结束分片', () => {
    const firstSentence = '甲'.repeat(550) + '。';
    const units = createUnits(firstSentence + '乙'.repeat(300) + '。');

    expect(buildChunks(units)[0]).toBe(firstSentence);
  });

  it('空单元数组不产生分片', () => {
    expect(splitTextUnits([], DEFAULT_CHUNK_OPTIONS)).toEqual([]);
  });
});

describe('buildChunkContent', () => {
  it('会把段落边界归一化并去掉首尾空白', () => {
    const units = createUnits('\n\n第一段\n\n\n第二段 \n ');

    expect(buildChunkContent(units, { startIndex: 0, endIndex: units.length })).toBe(
      '第一段\n\n第二段'
    );
  });

  it('只有空白的区间返回空串', () => {
    const units = createUnits('   \n  ');

    expect(buildChunkContent(units, { startIndex: 0, endIndex: units.length })).toBe('');
  });
});

describe('findRangeAnchors', () => {
  it('会跳过没有锚点的段落换行单元', () => {
    const units: TextUnit[] = [
      { value: '\n', start: null, end: null },
      { value: '正', start: 1, end: 2 },
      { value: '文', start: 2, end: 3 },
      { value: '\n', start: null, end: null },
    ];

    expect(findRangeAnchors(units, { startIndex: 0, endIndex: units.length })).toEqual({
      start: 1,
      end: 3,
    });
  });

  it('区间内没有任何锚点时两端都返回 null', () => {
    const units: TextUnit[] = [
      { value: '\n', start: null, end: null },
      { value: '\n', start: null, end: null },
    ];

    expect(findRangeAnchors(units, { startIndex: 0, endIndex: units.length })).toEqual({
      start: null,
      end: null,
    });
  });
});
