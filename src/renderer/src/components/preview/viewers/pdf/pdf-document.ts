import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * PDF viewer 的文档层：pdf.js 加载、共享 worker、首页尺寸。
 *
 * 踩过的坑，不要改：
 * - 只能用 legacy 构建（默认构建用了 Chromium 124 没有的 Promise.try）
 * - 不设 workerSrc：file:// 下 pdf.js 会包 blob worker 被 CSP 拦掉，退化成 fake worker
 * - useWorkerFetch:false，资源 URL 一律用 document.baseURI 拼成绝对地址
 */

const PDFJS_ASSET_BASE = new URL('pdfjs/', document.baseURI).href;

/** 全局共享一个 module worker：pdf.js 支持一个 worker 承载多个文档。 */
let sharedWorker: Worker | null = null;

function ensurePdfWorker(): void {
  if (sharedWorker) return;
  sharedWorker = new Worker(pdfWorkerUrl, { type: 'module' });
  pdfjs.GlobalWorkerOptions.workerPort = sharedWorker;
}

export interface PdfDocumentHandle {
  pdf: PDFDocumentProxy;
  destroy: () => Promise<void>;
}

/** 取文件字节并打开文档；关 Tab 时调用 destroy 释放 worker 侧资源。 */
export async function loadPdfDocument(url: string): Promise<PdfDocumentHandle> {
  ensurePdfWorker();
  const buffer = await (await fetch(url)).arrayBuffer();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  return { pdf, destroy: () => task.destroy() };
}

/**
 * 只取第一页尺寸，作为全书占位基准。
 *
 * 实测 30 份真实/合成样本共 965 页里，与首页尺寸不同的页为 0；
 * 每页渲染时仍会用该页自己的 viewport，这里只用于撑准滚动条。
 */
export async function readBasePageSize(
  pdf: PDFDocumentProxy
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/** pdf.js 会往文档里塞隐藏 canvas 量字宽，收起来避免撑开布局。 */
export function hidePdfMeasuringCanvases(): void {
  for (const hidden of document.querySelectorAll('.hiddenCanvasElement')) {
    Object.assign((hidden as HTMLElement).style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      display: 'none',
    });
  }
}
