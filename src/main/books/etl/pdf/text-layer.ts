import { readFile } from 'fs/promises';
import type { PDFiumLibrary } from '@hyzyla/pdfium';

/**
 * 全局 PDFium 实例。
 *
 * PDFium 的 WASM 堆无法可靠回收，重复 init/destroy 只增不减；实例常驻，
 * 文档对象用完立刻 destroy——占用大头是文档，不是库。
 *
 * 依赖在第一次读文本时才加载并初始化，主进程启动不背这部分开销。
 * 只能在主进程引用：依赖原生模块，渲染进程引入会在启动时崩溃。
 */
let libraryPromise: Promise<PDFiumLibrary> | null = null;

async function getPdfiumLibrary(): Promise<PDFiumLibrary> {
  if (libraryPromise) return libraryPromise;

  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  libraryPromise ??= PDFiumLibrary.init();
  return libraryPromise;
}

/** 一页的文本层内容；`page` 从 1 开始。 */
export interface PdfTextPage {
  page: number;
  text: string;
}

/** 一次文本层读取的结果；`pages` 与文档页序一一对应。 */
export interface PdfTextReport {
  pageCount: number;
  pages: PdfTextPage[];
}

/**
 * 读取 PDF 的文本层：只取文字，不渲染。
 *
 * 扫描版同样逐页读完（每页结果为空），不能只看首页就提前退出，否则混排书会漏判。
 *
 * @throws 文档加密、损坏或无法加载时抛出，不做降级。
 */
export async function readPdfText(filePath: string): Promise<PdfTextReport> {
  const library = await getPdfiumLibrary();
  const document = await library.loadDocument(await readFile(filePath));

  try {
    const pages: PdfTextPage[] = [];
    for (const [index, page] of [...document.pages()].entries()) {
      pages.push({ page: index + 1, text: page.getText() });
    }
    return { pageCount: pages.length, pages };
  } finally {
    document.destroy();
  }
}

/**
 * 一页至少有多少非空白字符才算「有文本层」。
 *
 * 扫描页即便带文本层，通常也只有书眉和印刷页码（个位数到十几个字符）；
 * 图页带题注约 30~100；正常正文页 500~2000。50 落在噪声线与真内容之间。
 */
export const PDF_PAGE_TEXT_MIN_CHARS = 50;

/**
 * 缺文本层的页占比不超过这个值时，整本仍按「有文本层」处理。
 *
 * 数字版缺页通常只有封面、插图页、空白页（不到 5%）；整章扫描的混排书通常远超 20%。
 * 取 10% 留余量，并偏向「有文本层」：误判成扫描版的代价更高。
 */
export const PDF_MISSING_PAGE_RATIO_MAX = 0.1;

/** 文本层判定结果。空文档与读取失败都按扫描版处理。 */
export type PdfTextKind = 'text' | 'scanned';

/** 一次判定的结论。 */
export interface PdfTextClassification {
  kind: PdfTextKind;
  pageCount: number;
  /** 达到阈值的页数 */
  textPages: number;
  /** 缺文本层的页数 */
  missingPages: number;
}

/** 非空白字符数。换行和缩进不该把「其实没有字」的页撑过阈值。 */
export function countTextChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * 按整本判定 PDF 是否可以直接取正文。
 *
 * 只回答整本的问题，不描述单页：混排书里少量缺文本层的页记为 missingPages。
 * 空文档按扫描版处理。
 */
export function classifyPdfText(report: PdfTextReport): PdfTextClassification {
  const { pageCount, pages } = report;
  if (pageCount === 0) {
    return { kind: 'scanned', pageCount: 0, textPages: 0, missingPages: 0 };
  }

  const textPages = pages.filter(
    page => countTextChars(page.text) >= PDF_PAGE_TEXT_MIN_CHARS
  ).length;
  const missingPages = pageCount - textPages;
  const kind: PdfTextKind =
    missingPages / pageCount <= PDF_MISSING_PAGE_RATIO_MAX ? 'text' : 'scanned';

  return { kind, pageCount, textPages, missingPages };
}
