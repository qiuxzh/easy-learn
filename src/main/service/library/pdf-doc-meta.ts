import { log } from '@main/logging';
import { readPdfInfo } from '@main/service/etl/pdf/inspect';
import { readPdfOutline } from '@main/service/etl/pdf/outline';
import { DOC_META_SCHEMA_VERSION, type PdfDocMeta } from '@shared/types/library';

/**
 * 导入时算一份完整的 PDF docMeta。
 *
 * 文字层判定走 PDFium（逐页 `getText()` + 50 字符阈值，保持既有语义），
 * 目录与页面标签走 pdf.js。两步顺序执行，不开后台任务、不并发多份资料，
 * 导入返回时元数据一定已经落库。
 *
 * 目录解析失败不阻断导入：toc 留 null，viewer 打开时会走前端回退并回写自愈。
 */
export async function readPdfDocMeta(filePath: string): Promise<PdfDocMeta> {
  const info = await readPdfInfo(filePath);

  let toc: PdfDocMeta['toc'] = null;
  let pageLabels: string[] | null = null;
  try {
    const outline = await readPdfOutline(filePath);
    toc = outline.toc;
    pageLabels = outline.pageLabels;
  } catch (error) {
    log.warn('[pdf-doc-meta] outline parse failed:', filePath, error);
  }

  return {
    format: 'pdf',
    schemaVersion: DOC_META_SCHEMA_VERSION,
    pageCount: info.pageCount,
    hasTextLayer: info.hasTextLayer,
    toc,
    pageLabels,
  };
}
