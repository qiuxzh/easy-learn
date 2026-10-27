/**
 * PDF 页读取：文本层判定、按页窗口与页面渲染。
 *
 * 判错了不会报错：判成「有文本层」会让缺字页悄悄进不了检索，判成「扫描版」会让用户以为整本都要识别；
 * 页窗口错了会让工具少读或多读页；渲染错了模型看到的就是另一页。所以边界值单独测。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PDF_MISSING_PAGE_RATIO_MAX,
  PDF_PAGE_TEXT_MIN_CHARS,
  classifyPdfText,
  countTextChars,
  readPdfPageTexts,
  renderPdfPagePng,
  type PdfTextReport,
} from '../pdf-pages';

let workDir: string | null = null;

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

/** 生成一份每页带一行文字的 PDF，返回文件路径。 */
async function createPdf(texts: string[]): Promise<string> {
  workDir = await mkdtemp(path.join(tmpdir(), 'pdf-page-'));
  const filePath = path.join(workDir, 'source.pdf');

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = document.addPage([200, 300]);
    page.drawText(text, { x: 20, y: 260, size: 12, font });
  }
  await writeFile(filePath, await document.save());
  return filePath;
}

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

describe('readPdfPageTexts', () => {
  it('只返回请求窗口内的页，并给出总页数', async () => {
    const filePath = await createPdf(['page 1', 'page 2', 'page 3']);

    const result = await readPdfPageTexts(filePath, 2, 3);

    expect(result.pageCount).toBe(3);
    expect(result.pages.map(page => page.page)).toEqual([2, 3]);
    expect(result.pages[0].text).toContain('page 2');
  });

  it('请求的结束页超过总页数时夹到末页', async () => {
    const filePath = await createPdf(['page 1', 'page 2', 'page 3']);

    const result = await readPdfPageTexts(filePath, 2, 99);

    expect(result.pages.map(page => page.page)).toEqual([2, 3]);
  });

  it('起始页越界时抛错并带出总页数', async () => {
    const filePath = await createPdf(['page 1', 'page 2', 'page 3']);

    await expect(readPdfPageTexts(filePath, 4, 4)).rejects.toThrow('本书共 3 页');
  });

  it('结束页小于起始页时抛错', async () => {
    const filePath = await createPdf(['page 1']);

    await expect(readPdfPageTexts(filePath, 2, 1)).rejects.toThrow('endPage 不能小于 startPage');
  });
});

describe('renderPdfPagePng', () => {
  it('输出 PNG 字节，尺寸与声明的宽高一致', async () => {
    const filePath = await createPdf(['page 1', 'page 2']);

    const rendered = await renderPdfPagePng(filePath, 2, 600);

    expect(rendered.pageCount).toBe(2);
    expect(rendered.width).toBe(400);
    expect(rendered.height).toBe(600);

    const bytes = Buffer.from(rendered.png);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.readUInt32BE(16)).toBe(rendered.width);
    expect(bytes.readUInt32BE(20)).toBe(rendered.height);
  });

  it('页码越界时抛错', async () => {
    const filePath = await createPdf(['page 1']);

    await expect(renderPdfPagePng(filePath, 2)).rejects.toThrow('本书共 1 页');
  });
});
