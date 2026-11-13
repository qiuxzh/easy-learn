import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_LENGTH, MAX_TEXT_LENGTH, sliceTextWindow } from '../util/truncate';

describe('sliceTextWindow', () => {
  it('窗口未超出时返回全文', () => {
    expect(sliceTextWindow('abcdef')).toEqual({
      text: 'abcdef',
      offset: 0,
      length: DEFAULT_TEXT_LENGTH,
      totalChars: 6,
      truncated: false,
      nextOffset: null,
    });
  });

  it('按 offset/length 截取并给出 nextOffset', () => {
    expect(sliceTextWindow('abcdef', { offset: 2, length: 2 })).toEqual({
      text: 'cd',
      offset: 2,
      length: 2,
      totalChars: 6,
      truncated: true,
      nextOffset: 4,
    });
  });

  it('负 offset 按 0 处理，length 夹到上限', () => {
    const result = sliceTextWindow('abcdef', {
      offset: -3,
      length: MAX_TEXT_LENGTH + 100,
    });

    expect(result.offset).toBe(0);
    expect(result.length).toBe(MAX_TEXT_LENGTH);
    expect(result.text).toBe('abcdef');
  });

  it('offset 超出文本时返回空窗口', () => {
    expect(sliceTextWindow('abc', { offset: 10 })).toEqual({
      text: '',
      offset: 10,
      length: DEFAULT_TEXT_LENGTH,
      totalChars: 3,
      truncated: false,
      nextOffset: null,
    });
  });
});
