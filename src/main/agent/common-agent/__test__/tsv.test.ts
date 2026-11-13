import { describe, expect, it } from 'vitest';
import { escapeTsvCell, toTsv } from '@main/agent/common-agent/util/tsv';

describe('escapeTsvCell', () => {
  it('空值输出空单元格', () => {
    expect(escapeTsvCell(null)).toBe('');
    expect(escapeTsvCell(undefined)).toBe('');
  });

  it('数字和布尔值转成文本', () => {
    expect(escapeTsvCell(0)).toBe('0');
    expect(escapeTsvCell(true)).toBe('true');
  });

  it('制表符、换行和回车替换成空格', () => {
    expect(escapeTsvCell('a\tb\nc\rd')).toBe('a b c d');
  });
});

describe('toTsv', () => {
  it('生成表头与数据行，空单元格保持列对齐', () => {
    expect(
      toTsv(
        ['id', 'name'],
        [
          ['1', 'a\tb'],
          [null, undefined],
        ]
      )
    ).toBe('id\tname\n1\ta b\n\t');
  });

  it('表头里的制表符也会被转义', () => {
    expect(toTsv(['a\tb'], [['x']])).toBe('a b\nx');
  });

  it('行列数不一致时抛出', () => {
    expect(() => toTsv(['a', 'b'], [['x']])).toThrow('列数不一致');
  });
});
