import { PDF_PAGE_TEXT_MIN_CHARS, countTextChars, type PdfTextReport } from '../pdf/text-layer';
import { LocatorScheme } from './locator';
import type { AnchorPoint, DocumentSource, SegmentInfo, TextUnit } from './types';

/** PDF 的文档单元：一页。 */
export interface PdfSegment extends SegmentInfo {
  /** 页码，从 1 开始；与定位串、阅读器页号一致 */
  page: number;
  /** 这一页的文本层内容 */
  text: string;
}

/** PDF 的定位锚点：只有页号。 */
interface PdfAnchor {
  page: number;
}

/**
 * 创建 PDF 文档源。
 *
 * 单元即一页，单元下标从 0 开始，与文件的页序一致。
 *
 * 定位只能到页：PDFium 的 TS 封装只暴露整页 `getText()`，没有块级文本接口，
 * 渲染层也没有页内字符偏移与 DOM 之间的映射。所以所有锚点编码出来都是 `pdf:<页号>`，
 * 命中后能跳到页，但跳不到页内某一行。要做字符级定位，得另接 pdf.js 的文本层映射。
 *
 * 缺文本层的页（低于单页阈值）不产出文本单元，切分器自然跳过它。
 */
export function createPdfSource(report: PdfTextReport): DocumentSource<PdfSegment> {
  return {
    async listSegments(): Promise<PdfSegment[]> {
      return report.pages.map((page, index) => ({
        index,
        id: String(page.page),
        page: page.page,
        text: page.text,
        fallbackLocator: `${LocatorScheme.pdf}${page.page}`,
      }));
    },

    /** 把一页文本拆成逐字符单元；换行压成空格，避免版面换行变成分片边界。 */
    async loadTextUnits(segment: PdfSegment): Promise<TextUnit[]> {
      return buildPageUnits(segment);
    },

    /** 锚点只有页号，所以一页内任意位置都编码成同一个定位串。 */
    encodeLocator(_segment: PdfSegment, anchor: AnchorPoint): string | null {
      return isPdfAnchor(anchor) ? `${LocatorScheme.pdf}${anchor.page}` : null;
    },
  };
}

/**
 * 把一页文本拆成文本单元。
 *
 * PDF 的换行是版面换行而不是段落分隔，所以压成空格。
 * 低于单页阈值的页整页跳过：那种页只会切出「42」这样的噪声分片。
 */
function buildPageUnits(segment: PdfSegment): TextUnit[] {
  if (countTextChars(segment.text) < PDF_PAGE_TEXT_MIN_CHARS) return [];
  const anchor: PdfAnchor = { page: segment.page };

  const lines = segment.text
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const units: TextUnit[] = [];
  for (const [index, line] of lines.entries()) {
    // 段与段之间留一个空格，避免两行直接粘成一个词
    if (index > 0) units.push({ value: ' ', start: null, end: null });
    for (const char of line) {
      units.push({ value: char, start: anchor, end: anchor });
    }
  }
  return units;
}

function isPdfAnchor(anchor: AnchorPoint): anchor is PdfAnchor {
  if (typeof anchor !== 'object' || anchor === null || !('page' in anchor)) return false;
  return typeof anchor.page === 'number';
}
