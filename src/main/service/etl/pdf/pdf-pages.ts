import { readFile } from 'node:fs/promises';
import type { PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium';

/**
 * 全局 PDFium 实例。
 *
 * PDFium 的 WASM 堆无法可靠回收，重复 init/destroy 只增不减；实例常驻，
 * 文档对象用完立刻 destroy——占用大头是文档，不是库。
 *
 * 依赖在第一次用到时才加载并初始化，主进程启动不背这部分开销。
 * 只能在主进程引用：它按 import.meta.url 定位同目录的 pdfium.wasm，进渲染进程的 bundle 后路径会失效。
 */
let libraryPromise: Promise<PDFiumLibrary> | null = null;

async function getPdfiumLibrary(): Promise<PDFiumLibrary> {
  if (libraryPromise) return libraryPromise;

  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  libraryPromise ??= PDFiumLibrary.init();
  return libraryPromise;
}

/**
 * 打开 PDF、执行读取，结束时销毁文档。
 *
 * 文档对象占的是 WASM 堆的大头，任何读取路径都必须保证销毁；打开与销毁收敛在这里。
 */
async function withPdfDocument<T>(
  filePath: string,
  read: (document: PDFiumDocument) => T | Promise<T>
): Promise<T> {
  const library = await getPdfiumLibrary();
  const document = await library.loadDocument(await readFile(filePath));

  try {
    return await read(document);
  } finally {
    document.destroy();
  }
}

/** 一页的文本层内容；`page` 从 1 开始。 */
export interface PdfTextPage {
  page: number;
  text: string;
}

/** 一次文本层读取的结果；`pageCount` 是总页数，`pages` 是本次读到的页。 */
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
  return withPdfDocument(filePath, document => {
    const pages: PdfTextPage[] = [];
    for (const [index, page] of [...document.pages()].entries()) {
      pages.push({ page: index + 1, text: page.getText() });
    }
    return { pageCount: pages.length, pages };
  });
}

/**
 * 读取 PDF 指定页范围的文本层。
 *
 * 与 {@link readPdfText} 的区别只在读取窗口：按页取文本时不把整本读完。
 * `endPage` 超过实际页数时夹到末页。
 *
 * @param startPage 起始页，从 1 开始，含
 * @param endPage 结束页，从 1 开始，含
 * @returns 总页数与窗口内的页文本
 * @throws 文档加密、损坏，`startPage` 超出 1..总页数，或 `endPage < startPage` 时抛出
 */
export async function readPdfPageTexts(
  filePath: string,
  startPage: number,
  endPage: number
): Promise<PdfTextReport> {
  if (endPage < startPage) {
    throw new Error('页码范围无效：endPage 不能小于 startPage');
  }

  return withPdfDocument(filePath, document => {
    const pageCount = document.getPageCount();
    if (startPage < 1 || startPage > pageCount) {
      throw new Error(`页码超出范围：本书共 ${pageCount} 页`);
    }

    const lastPage = Math.min(endPage, pageCount);
    const pages: PdfTextPage[] = [];
    for (let page = startPage; page <= lastPage; page += 1) {
      pages.push({ page, text: document.getPage(page - 1).getText() });
    }

    return { pageCount, pages };
  });
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

/** 页面图的目标长边像素；与附件服务的尺寸上限一致，落盘前不必再缩一次。 */
const DEFAULT_TARGET_EDGE = 2000;

/** 渲染倍率上限。小页面放得太大只增加体积，不增加可读信息。 */
const MAX_SCALE = 3;

/** 一次页面渲染的结果；`png` 是编码后的 PNG 字节。 */
export interface RenderedPdfPage {
  pageCount: number;
  width: number;
  height: number;
  png: Uint8Array;
}

/**
 * 把 PDF 的一页渲染成 PNG。
 *
 * PDFium 只输出 RGBA 位图，编码成 PNG 需要外部编码器；这里用 @napi-rs/canvas，
 * 它同时承担了画布和 PNG 编码，避免再引一个只做编码的依赖。
 *
 * 注意 `page.render()` 成功后会关闭该页对象，之后不能再对同一个 page 调用 getText()；
 * 需要文字就重新 `getPage()`。
 *
 * @param page 页码，从 1 开始
 * @param targetEdge 目标长边像素，实际倍率被限制在 {@link MAX_SCALE} 以内
 * @returns 总页数、图片尺寸与 PNG 字节
 * @throws 文档加密、损坏，或 `page` 超出 1..总页数 时抛出
 */
export async function renderPdfPagePng(
  filePath: string,
  page: number,
  targetEdge = DEFAULT_TARGET_EDGE
): Promise<RenderedPdfPage> {
  return withPdfDocument(filePath, async document => {
    const pageCount = document.getPageCount();
    if (page < 1 || page > pageCount) {
      throw new Error(`页码超出范围：本书共 ${pageCount} 页`);
    }

    const pdfPage = document.getPage(page - 1);
    const { originalWidth, originalHeight } = pdfPage.getOriginalSize();
    const scale = Math.min(MAX_SCALE, targetEdge / Math.max(originalWidth, originalHeight));

    const image = await pdfPage.render({
      scale,
      render: async ({ width, height, data }) => {
        const { createCanvas } = await import('@napi-rs/canvas');
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        const bitmap = context.createImageData(width, height);
        bitmap.data.set(data);
        context.putImageData(bitmap, 0, 0);
        return canvas.encode('png');
      },
    });

    return { pageCount, width: image.width, height: image.height, png: image.data };
  });
}
