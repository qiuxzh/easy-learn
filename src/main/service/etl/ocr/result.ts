import type { BookPageBlock, OcrRect, OcrTextBlockType } from '@shared/types/ocr';

/**
 * 识别引擎无关的 OCR 结果类型。
 *
 * 不同识别服务的返回值先转换成这里的形状，再交给落库与分片。
 */

/** 一页里的一个文字块。 */
export interface OcrTextBlock {
  type: OcrTextBlockType;
  text: string;
  bbox: OcrRect | null;
}

/** 一页里的一张插图：地址是识别服务给的临时地址，还没下载。 */
export interface OcrImage {
  /** 引擎侧的名字（PaddleOCR 是带坐标的文件名），只用于日志 */
  name: string;
  /** 临时地址，必须当场下载 */
  url: string;
  bbox: OcrRect | null;
}

/** 一页的 OCR 结果。`page` 是原书里的绝对页号，从 1 开始。 */
export interface OcrPageResult {
  page: number;
  blocks: OcrTextBlock[];
  images: OcrImage[];
}

/**
 * 把已经下载成附件的插图按位置合回文字块之间。
 *
 * 只依赖块与图片的 bbox，与引擎无关：找包含图片中心的块，插在它之后
 * （表格里的插图就紧跟在表格后面）；没有包含关系时按纵坐标插入；
 * 解析不出坐标才退回页尾。
 */
export function mergePageBlocks(
  blocks: OcrTextBlock[],
  images: Array<{ bbox: OcrRect | null; attachmentId: string }>
): BookPageBlock[] {
  const positioned = images
    .map((image, order) => ({
      position: findInsertIndex(blocks, image.bbox),
      attachmentId: image.attachmentId,
      bbox: image.bbox,
      order,
    }))
    .sort((left, right) => left.position - right.position || left.order - right.order);

  const merged: BookPageBlock[] = [];
  let cursor = 0;

  for (const image of positioned) {
    while (cursor < image.position) {
      merged.push(toTextBlock(blocks[cursor]));
      cursor += 1;
    }
    merged.push({ type: 'image', attachmentId: image.attachmentId, bbox: image.bbox });
  }
  while (cursor < blocks.length) {
    merged.push(toTextBlock(blocks[cursor]));
    cursor += 1;
  }

  return merged;
}

/**
 * 把一页的 OCR 块拼成纯文本。
 *
 * 图片块没有文字，跳过；表格块的 text 是 HTML，原样保留。
 * 块数组的顺序就是阅读顺序，不再排序。
 */
export function ocrBlocksToText(blocks: BookPageBlock[]): string {
  return blocks
    .filter((block): block is Extract<BookPageBlock, { text: string }> => block.type !== 'image')
    .map(block => block.text)
    .join('\n');
}

/** 插入位置：返回在 blocks 中的下标，范围 0..blocks.length。 */
function findInsertIndex(blocks: OcrTextBlock[], bbox: OcrRect | null): number {
  if (!bbox) return blocks.length;

  const centerX = (bbox[0] + bbox[2]) / 2;
  const centerY = (bbox[1] + bbox[3]) / 2;

  // 包含中心的块里取面积最小的那个，避免被整页框抢走
  let container = -1;
  let containerArea = Number.POSITIVE_INFINITY;
  for (const [index, block] of blocks.entries()) {
    const rect = block.bbox;
    if (!rect) continue;
    const inside =
      rect[0] <= centerX && centerX <= rect[2] && rect[1] <= centerY && centerY <= rect[3];
    if (!inside) continue;
    const area = (rect[2] - rect[0]) * (rect[3] - rect[1]);
    if (area < containerArea) {
      container = index;
      containerArea = area;
    }
  }
  if (container >= 0) return container + 1;

  // 没有包含关系：插在第一块比它更靠下的块之前
  for (const [index, block] of blocks.entries()) {
    if (block.bbox && block.bbox[1] > centerY) return index;
  }
  return blocks.length;
}

function toTextBlock(block: OcrTextBlock): BookPageBlock {
  return { type: block.type, text: block.text, bbox: block.bbox };
}
