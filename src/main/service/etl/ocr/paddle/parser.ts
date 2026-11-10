import type { DocParsingPage, DocParsingResult } from '@paddleocr/api-sdk';
import type { OcrRect, OcrTextBlockType } from '@shared/types/ocr';
import type { OcrImage, OcrPageResult, OcrTextBlock } from '../result';

/**
 * 把 PaddleOCR 的返回结构转换成 `OcrPageResult`。
 *
 * 文字块在 `parsing_res_list`，插图只在 `markdownImages`（键名里带坐标）。
 * 这里只做翻译：插图下载与排序不在本文件。
 */

/**
 * 服务端标签映射成闭集类型。`null` 表示这类块直接丢弃。
 *
 * 页眉、页脚、页码不属于正文，丢弃；未收录的标签兜底成 `text`，只退化不让整页失败。
 */
const LABEL_TYPES: Record<string, OcrTextBlockType | null> = {
  text: 'text',
  content: 'text',
  paragraph_title: 'title',
  doc_title: 'title',
  abstract: 'title',
  figure_title: 'caption',
  table: 'table',
  display_formula: 'formula',
  inline_formula: 'formula',
  aside_text: 'aside',
  footnote: 'aside',
  header: null,
  footer: null,
  number: null,
  image: null,
  header_image: null,
  footer_image: null,
};

/**
 * 把一次任务的返回结果映射成逐页的块与图片。
 *
 * 绝对页号 = 起始页 + 数组下标：接口不返回绝对页码，分块上传时必须自己换算。
 */
export function parsePaddleResult(result: DocParsingResult, startPage: number): OcrPageResult[] {
  return result.pages.map((page, index) => ({
    page: startPage + index,
    blocks: parseBlocks(page),
    images: parseImages(page),
  }));
}

/** 从 markdownImages 的键名里解析图片框：`..._box_<x1>_<y1>_<x2>_<y2>.<ext>`。 */
export function parseImageBox(name: string): OcrRect | null {
  const match = /_box_(\d+)_(\d+)_(\d+)_(\d+)\.[A-Za-z0-9]+$/.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

function parseBlocks(page: DocParsingPage): OcrTextBlock[] {
  const list = readParsingList(page);
  const blocks: OcrTextBlock[] = [];

  for (const item of list) {
    const label = typeof item.block_label === 'string' ? item.block_label : '';
    const type = Object.prototype.hasOwnProperty.call(LABEL_TYPES, label)
      ? LABEL_TYPES[label]
      : 'text';
    if (!type) continue;

    const text = typeof item.block_content === 'string' ? item.block_content.trim() : '';
    if (!text) continue;

    blocks.push({ type, text, bbox: readRect(item.block_bbox) });
  }

  return blocks;
}

function parseImages(page: DocParsingPage): OcrImage[] {
  return Object.entries(page.markdownImages ?? {}).map(([name, url]) => ({
    name,
    url,
    bbox: parseImageBox(name),
  }));
}

function readParsingList(page: DocParsingPage): Array<Record<string, unknown>> {
  const pruned = page.prunedResult;
  if (typeof pruned !== 'object' || pruned === null) return [];
  const list = (pruned as { parsing_res_list?: unknown }).parsing_res_list;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
  );
}

function readRect(value: unknown): OcrRect | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const numbers = value.slice(0, 4).map(Number);
  return numbers.every(Number.isFinite) ? (numbers as OcrRect) : null;
}
