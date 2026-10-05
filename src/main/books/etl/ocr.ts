import { readdir } from 'fs/promises';
import path from 'path';
import { Model, PaddleOCRClient } from '@paddleocr/api-sdk';

/** PaddleOCR-VL-1.6 文档解析的模型标识 */
const OCR_MODEL = Model.PaddleOCRVL16;

/**
 * 文字类块的语义类型（闭集）。
 *
 * 服务端返回的标签（block_label）不透传给下游，一律映射到这里；
 * 映射不到的一律兜底为 `text`，而不是报错——新标签进来只退化，不让整页失败。
 */
export type OcrBlockType =
  | 'text' // 正文段落（服务端 text）
  | 'title' // 章节标题与文档标题（服务端 paragraph_title / doc_title / abstract）
  | 'runningHead' // 书眉，章号线索（服务端 header）
  | 'pageNumber' // 印刷页码（服务端 number）
  | 'caption' // 题注，图题与表题共用（服务端 figure_title）
  | 'table' // 表格，内容是 HTML 而非纯文本（服务端 table）
  | 'formula' // 行间公式，内容是 $$...$$（服务端 display_formula）
  | 'aside'; // 边注与脚注（服务端 aside_text / footnote）

/**
 * 服务端标签 → 闭集类型的映射表。
 *
 * 只收录实测出现过的标签；未收录的（如 footer / chart / seal 等）
 * 由 mapBlockType 兜底成 text。实测依据：3 批探针、15 页、约 181 块。
 */
const OCR_BLOCK_TYPE_MAP: Record<string, OcrBlockType> = {
  text: 'text',
  paragraph_title: 'title',
  doc_title: 'title',
  abstract: 'title',
  header: 'runningHead',
  number: 'pageNumber',
  figure_title: 'caption',
  table: 'table',
  display_formula: 'formula',
  aside_text: 'aside',
  footnote: 'aside',
};

/** 图片类标签：内容恒为空串，不属于文字块 */
const OCR_IMAGE_LABELS = new Set(['image', 'header_image', 'footer_image']);

/** 一个文字块：只有类型和内容，不留坐标也不留服务端块序 */
export interface OcrBlock {
  type: OcrBlockType;
  content: string;
}

/** 一个图片块：只留服务端给的文件名 */
export interface OcrImageBlock {
  sourceFileName: string;
}

/** 单页的识别结果 */
export interface OcrPage {
  /** 这一页来自哪个图片文件 */
  filePath: string;
  blocks: OcrBlock[];
  images: OcrImageBlock[];
}

/**
 * 服务端标签 → 闭集类型。闭集外的标签一律兜底成 text
 */
function mapBlockType(label: unknown): OcrBlockType {
  if (typeof label !== 'string') {
    return 'text';
  }
  return OCR_BLOCK_TYPE_MAP[label] ?? 'text';
}

/**
 * 从服务端返回的一页结果里取出块数组。
 * prunedResult 的形态由服务端决定，这里只做必要的形状检查
 */
function readParsingList(prunedResult: unknown): Array<Record<string, unknown>> | null {
  if (typeof prunedResult !== 'object' || prunedResult === null) {
    return null;
  }
  const list = (prunedResult as Record<string, unknown>).parsing_res_list;
  if (!Array.isArray(list)) {
    return null;
  }
  return list.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
  );
}

/**
 * 对一张图片做文档解析。输入图片路径与访问令牌，返回该页的文字块与图片块
 *
 * TODO 提交队列满（HTTP 400 + code 10010）时的退避重试，等接入流水线时再加
 */
export async function ocrPage(filePath: string, token: string): Promise<OcrPage> {
  const client = new PaddleOCRClient({ token, requestTimeout: 300_000, pollTimeout: 600_000 });
  const result = await client.parseDocument({
    filePath,
    model: OCR_MODEL,
    options: {
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    },
  });

  const blocks: OcrBlock[] = [];
  const images: OcrImageBlock[] = [];

  // 一张输入图对应一页结果
  for (const page of result.pages) {
    const parsingList = readParsingList(page.prunedResult);
    if (!parsingList) {
      continue;
    }
    for (const item of parsingList) {
      const label = item.block_label;
      const content = typeof item.block_content === 'string' ? item.block_content : '';

      // 图片块没有文字内容，只记下服务端给的块标识
      if (typeof label === 'string' && OCR_IMAGE_LABELS.has(label)) {
        images.push({ sourceFileName: String(item.block_id ?? '') });
        continue;
      }

      // 空内容的文字块没有意义，跳过
      if (content === '') {
        continue;
      }

      blocks.push({ type: mapBlockType(label), content });
    }
  }

  return { filePath, blocks, images };
}

/**
 * 对一个文件夹里的所有图片逐个做解析，按文件名排序保证页序稳定
 */
export async function ocrPages(dirPath: string, token: string): Promise<OcrPage[]> {
  const entries = await readdir(dirPath);
  const files = entries.filter(name => /\.(png|jpg|jpeg)$/i.test(name)).sort();

  const pages: OcrPage[] = [];
  for (const name of files) {
    pages.push(await ocrPage(path.join(dirPath, name), token));
  }
  return pages;
}
