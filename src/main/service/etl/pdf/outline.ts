import { readFile } from 'node:fs/promises';
import { buildPdfToc, type PdfOutlineSourceNode } from '@shared/utils/pdf-outline';
import type { PdfToc } from '@shared/types/library';

/**
 * 主进程的 PDF 目录解析。
 *
 * 为什么这里用 pdf.js 而文字提取用 PDFium：`@hyzyla/pdfium` 的封装只暴露整页
 * `getText()`，没有 bookmark / outline API；pdf.js 的 `getOutline()` +
 * `getDestination()` + `getPageIndex()` 是现成的一条链，且与渲染层 viewer 用的是
 * 同一套解析引擎，页号天然对齐。
 *
 * 只取文档级信息（不渲染页面），所以不需要 cmaps / standard_fonts / wasm / iccs，
 * 也不设 workerSrc —— Node 下 pdf.js 会自动用 fake worker（已实测）。
 */

export interface PdfOutlineResult {
  toc: PdfToc;
  pageLabels: string[] | null;
}

/** pdf.js 的页面引用形如 { num, gen }。 */
function isPageRef(value: unknown): value is { num: number; gen: number } {
  if (!value || typeof value !== 'object') return false;
  const ref = value as { num?: unknown; gen?: unknown };
  return typeof ref.num === 'number' && typeof ref.gen === 'number';
}

/** 读取一份 PDF 的内置目录与页面标签；文档加密、损坏或无法加载时抛出。 */
export async function readPdfOutline(filePath: string): Promise<PdfOutlineResult> {
  // pdfjs-dist 在 main 的 external 列表里，动态 import 走 node resolution，
  // 不要把 worker 一起打进主 bundle（external 策略与 @hyzyla/pdfium 一致）。
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(filePath));
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
  });

  try {
    const doc = await task.promise;
    const [outline, labels] = await Promise.all([doc.getOutline(), doc.getPageLabels()]);

    const resolvePage = async (dest: string | unknown[] | null): Promise<number | null> => {
      if (!dest) return null;
      try {
        const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
        const ref = explicit?.[0];
        if (!isPageRef(ref)) return null;
        return (await doc.getPageIndex(ref)) + 1;
      } catch {
        return null;
      }
    };

    const toc = await buildPdfToc(
      (outline ?? null) as unknown as PdfOutlineSourceNode[] | null,
      resolvePage,
      labels ?? null
    );

    return { toc, pageLabels: labels ?? null };
  } finally {
    // PDFDocumentProxy 没有 destroy；要销毁的是 loadingTask
    await task.destroy();
  }
}
