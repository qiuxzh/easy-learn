import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

/** 切出来的一块：页号是原书里的绝对页号，闭区间。 */
export interface PdfChunk {
  start: number;
  end: number;
  /** 切出的临时 PDF 路径 */
  filePath: string;
}

export interface PdfSplitResult {
  /** 原书总页数 */
  pageCount: number;
  chunks: PdfChunk[];
}

/**
 * 把 PDF 按页数切成若干个小文件。
 *
 * 用 pdf-lib 按页拷贝，不重新渲染：文本层、矢量图、字体原样保留。
 * 源文档只在切分期间驻留内存；块文件归调用方所有，用完由调用方删除。
 */
export async function splitPdf(
  filePath: string,
  pageSize: number,
  workDir: string
): Promise<PdfSplitResult> {
  const source = await PDFDocument.load(await readFile(filePath));
  const pageCount = source.getPageCount();

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const chunks: PdfChunk[] = [];
  for (let start = 1; start <= pageCount; start += pageSize) {
    const end = Math.min(start + pageSize - 1, pageCount);
    const target = await PDFDocument.create();

    const indexes = Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset);
    const pages = await target.copyPages(source, indexes);
    for (const page of pages) target.addPage(page);

    const chunkPath = path.join(workDir, `chunk_${pad(start)}_${pad(end)}.pdf`);
    await writeFile(chunkPath, await target.save());
    chunks.push({ start, end, filePath: chunkPath });
  }

  return { pageCount, chunks };
}

/** 页号补零，保证目录里按页序排列。 */
function pad(page: number): string {
  return String(page).padStart(4, '0');
}
