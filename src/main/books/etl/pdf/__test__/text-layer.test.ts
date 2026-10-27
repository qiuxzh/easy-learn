/**
 * PDF 文本层判定。
 *
 * 判错了不会报错：判成「有文本层」会让缺字页悄悄进不了检索，判成「扫描版」 会让用户以为整本都要识别。所以边界值单独测。
 */
import { describe, expect, it } from 'vitest';
import {
  PDF_MISSING_PAGE_RATIO_MAX,
  PDF_PAGE_TEXT_MIN_CHARS,
  classifyPdfText,
  countTextChars,
} from '../text-layer';
import type { PdfTextReport } from '../text-layer';

/** 造一份报告：pages 里每个元素是一页的文本。 */
function reportOf(texts: string[]): PdfTextReport {
  return {
    pageCount: texts.length,
    pages: texts.map((text, index) => ({ page: index + 1, text })),
  };
}

describe('countTextChars', () => {
  it('空白不计入字符数', () => {
    expect(countTextChars(' 一 二 \n 三\t')).toBe(3);
  });
});

describe('classifyPdfText', () => {
  it('空文档按扫描版处理', () => {
    expect(classifyPdfText(reportOf([])).kind).toBe('scanned');
  });

  it('每一页都有足够文字时判为有文本层', () => {
    const report = reportOf([`字`.repeat(PDF_PAGE_TEXT_MIN_CHARS), '内容'.repeat(200)]);
    const result = classifyPdfText(report);
    expect(result.kind).toBe('text');
    expect(result.missingPages).toBe(0);
  });

  it('恰好等于单页阈值的页算有文本层', () => {
    const report = reportOf(['字'.repeat(PDF_PAGE_TEXT_MIN_CHARS)]);
    expect(classifyPdfText(report).missingPages).toBe(0);
  });

  it('差一个字符就不算', () => {
    const report = reportOf(['字'.repeat(PDF_PAGE_TEXT_MIN_CHARS - 1)]);
    expect(classifyPdfText(report).missingPages).toBe(1);
  });

  it('缺页占比等于上限时仍按有文本层处理', () => {
    // 10 页缺 1 页 = 0.1，正好等于上限
    const pages = Array.from({ length: 10 }, (_, index) =>
      index === 0 ? '字'.repeat(10) : '字'.repeat(200)
    );
    const result = classifyPdfText(reportOf(pages));
    expect(PDF_MISSING_PAGE_RATIO_MAX).toBe(0.1);
    expect(result.kind).toBe('text');
    expect(result.missingPages).toBe(1);
  });

  it('超过上限就判为扫描版', () => {
    // 10 页缺 2 页 = 0.2
    const pages = Array.from({ length: 10 }, (_, index) =>
      index < 2 ? '字'.repeat(10) : '字'.repeat(200)
    );
    const result = classifyPdfText(reportOf(pages));
    expect(result.kind).toBe('scanned');
    expect(result.missingPages).toBe(2);
  });

  it('全是空白页时判为扫描版', () => {
    const result = classifyPdfText(reportOf(['', ' \n ', '\t']));
    expect(result.kind).toBe('scanned');
    expect(result.missingPages).toBe(3);
  });
});
