import { classifyPdfText, readPdfText } from './pdf-pages';

/** PDF 的页数与文本层判定结果。 */
export interface PdfInfo {
  pageCount: number;
  hasTextLayer: boolean;
}

/**
 * 读取 PDF 的页数与文本层情况。
 *
 * @param filePath PDF 的绝对路径
 * @throws 文档加密、损坏或无法读取时抛出
 */
export async function readPdfInfo(filePath: string): Promise<PdfInfo> {
  const report = await readPdfText(filePath);
  const classification = classifyPdfText(report);
  return {
    pageCount: report.pageCount,
    hasTextLayer: classification.kind === 'text',
  };
}
