import { joinIndir, fromRange } from 'foliate-js/epubcfi.js';
import { extractMathFormula, formatMathFormula, isDisplayMath, isMathElement } from './formula';
import type { FoliateBook } from '@/components/reader/foliate-types';
import type { InsertBookChunkRow } from '../db/schema';

/** xmldom 未暴露全局 Node 构造器，因此使用 DOM 标准节点类型常量。 */
const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;
const DOCUMENT_NODE_TYPE = 9;

/** Chunk 的目标长度、自然边界下限、硬上限和相邻分片重叠长度。 */
const TARGET_CHUNK_LENGTH = 600;
const MIN_CHUNK_LENGTH = 300;
const MAX_CHUNK_LENGTH = 800;
const OVERLAP_LENGTH = 120;

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const TEXTLESS_TAGS = new Set([
  'audio',
  'canvas',
  'head',
  'noscript',
  'script',
  'style',
  'svg',
  'template',
  'video',
]);
const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '\n']);

/** 原始 DOM 文本节点中的位置，用于在文本清洗后仍能生成正确 CFI。 */
interface TextPosition {
  node: Node;
  offset: number;
}

/**
 * 可检索文本的最小单元。
 * start 和 end 为 null 表示这是为保留段落语义而插入的换行，不对应 EPUB 中的真实位置。
 */
interface TextUnit {
  value: string;
  start: TextPosition | null;
  end: TextPosition | null;
}

/** 在 TextUnit 数组中的半开区间，用于先确定切分边界，再生成内容和 CFI。 */
interface ChunkRange {
  startIndex: number;
  endIndex: number;
}

interface BuildBookChunksOptions {
  bookId: string;
  book: FoliateBook;
}

/** 将 EPUB 全部 section 切分为可持久化的正文 Chunk。 */
export async function buildBookChunks({
  bookId,
  book,
}: BuildBookChunksOptions): Promise<InsertBookChunkRow[]> {
  const chunks: InsertBookChunkRow[] = [];

  // 不跨 section 切分，确保每个 Chunk 的 CFI 都可由该 section 的基础 CFI 可靠生成。
  for (const [sectionIndex, section] of book.sections.entries()) {
    if (!section.createDocument) continue;
    if (!section.cfi) {
      throw new Error(`Section CFI missing: ${section.id}`);
    }

    const document = await section.createDocument();
    // 先保留 DOM 位置，再基于文本单元切分；不能只处理清洗后的字符串，否则无法精确跳转。
    const units = collectTextUnits(document.documentElement);
    const ranges = splitTextUnits(units);

    for (const [chunkIndex, range] of ranges.entries()) {
      const chunk = createChunk(units, range, section.cfi);
      if (!chunk) continue;

      chunks.push({
        id: `${bookId}:${sectionIndex}:${chunkIndex}`,
        bookId,
        sectionIndex,
        sectionId: section.id,
        href: section.id,
        chunkIndex,
        content: chunk.content,
        startCfi: chunk.startCfi,
        endCfi: chunk.endCfi,
      });
    }
  }

  return chunks;
}

/** 遍历 section DOM，将正文转换为保留原始节点位置的文本单元。 */
function collectTextUnits(root: Node): TextUnit[] {
  const units: TextUnit[] = [];

  /** 递归收集当前节点及其子节点中的可检索正文。 */
  const visit = (node: Node): void => {
    if (node.nodeType === TEXT_NODE_TYPE) {
      appendTextUnits(units, node);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE_TYPE && node.nodeType !== DOCUMENT_NODE_TYPE) return;

    const tagName = node.nodeName.toLowerCase();
    if (isMathElement(tagName) && appendMathFormula(units, node as Element)) return;
    if (TEXTLESS_TAGS.has(tagName)) return;

    const isBlock = BLOCK_TAGS.has(tagName);
    if (isBlock) appendBlockBreak(units);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
    if (isBlock) appendBlockBreak(units);
  };

  visit(root);
  return trimBoundaryBreaks(units);
}

/**
 * 将 MathML 公式追加为一个不可拆分的文本单元。
 * 优先复用 TeX annotation，避免重新转换丢精度；没有 annotation 时再转换 MathML。
 */
function appendMathFormula(units: TextUnit[], element: Element): boolean {
  const latex = extractMathFormula(element);
  if (!latex) return false;

  const start = findFirstTextPosition(element);
  const end = findLastTextPosition(element);
  if (!start || !end) return false;

  const isDisplay = isDisplayMath(element);
  if (isDisplay) appendBlockBreak(units);
  units.push({
    value: formatMathFormula(element, latex),
    start,
    end,
  });
  if (isDisplay) appendBlockBreak(units);
  return true;
}

/** 获取公式子树中的首个文本位置，用于生成起始 CFI。 */
function findFirstTextPosition(node: Node): TextPosition | null {
  if (node.nodeType === TEXT_NODE_TYPE && node.nodeValue) {
    return { node, offset: 0 };
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const position = findFirstTextPosition(child);
    if (position) return position;
  }
  return null;
}

/** 获取公式子树中的末尾文本位置，用于生成结束 CFI。 */
function findLastTextPosition(node: Node): TextPosition | null {
  if (node.nodeType === TEXT_NODE_TYPE && node.nodeValue) {
    return { node, offset: node.nodeValue.length };
  }
  for (let child = node.lastChild; child; child = child.previousSibling) {
    const position = findLastTextPosition(child);
    if (position) return position;
  }
  return null;
}

/** 将一个文本节点拆为字符级单元，并将连续空白压缩为单个空格。 */
function appendTextUnits(units: TextUnit[], node: Node): void {
  const text = node.nodeValue ?? '';

  for (let offset = 0; offset < text.length; ) {
    const codePoint = text.codePointAt(offset);
    if (codePoint === undefined) break;

    const value = String.fromCodePoint(codePoint);
    const length = value.length;
    const position = { node, offset };
    const endPosition = { node, offset: offset + length };

    if (/\s/u.test(value)) {
      appendWhitespace(units, position, endPosition);
    } else {
      units.push({ value, start: position, end: endPosition });
    }
    offset += length;
  }
}

/** 追加空白单元，并合并相邻空白以稳定 Chunk 字符长度。 */
function appendWhitespace(units: TextUnit[], start: TextPosition, end: TextPosition): void {
  const last = units.at(-1);
  if (!last || last.value === '\n') return;
  if (last.value === ' ') {
    last.end = end;
    return;
  }
  units.push({ value: ' ', start, end });
}

/** 在块级元素之间插入换行，保留段落语义。 */
function appendBlockBreak(units: TextUnit[]): void {
  const last = units.at(-1);
  if (!last || last.value === '\n') return;
  if (last.value === ' ') {
    last.value = '\n';
    last.start = null;
    last.end = null;
    return;
  }
  units.push({ value: '\n', start: null, end: null });
}

/** 移除 section 开头和末尾无定位价值的换行。 */
function trimBoundaryBreaks(units: TextUnit[]): TextUnit[] {
  let start = 0;
  let end = units.length;

  while (start < end && units[start].value === '\n') start++;
  while (end > start && units[end - 1].value === '\n') end--;
  return units.slice(start, end);
}

/** 按目标长度、最大长度和重叠长度生成连续的 Chunk 区间。 */
function splitTextUnits(units: TextUnit[]): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  let startIndex = 0;

  while (startIndex < units.length) {
    const endIndex = findChunkEndIndex(units, startIndex);
    if (endIndex <= startIndex) break;

    ranges.push({ startIndex, endIndex });
    if (endIndex === units.length) break;
    // 以字符单元回退形成重叠；至少前进一个单元，避免极端文本导致死循环。
    startIndex = Math.max(startIndex + 1, endIndex - OVERLAP_LENGTH);
  }

  return ranges;
}

/** 优先在目标长度附近的句末或段落边界结束当前 Chunk。 */
function findChunkEndIndex(units: TextUnit[], startIndex: number): number {
  const remainingLength = units.length - startIndex;
  if (remainingLength <= MAX_CHUNK_LENGTH) return units.length;

  const targetIndex = startIndex + TARGET_CHUNK_LENGTH;
  const maximumIndex = startIndex + MAX_CHUNK_LENGTH;

  // 优先向后扩展到自然边界，使大多数 Chunk 靠近目标长度但不超过最大长度。
  for (let index = targetIndex; index < maximumIndex; index++) {
    if (isSentenceEnding(units[index])) return index + 1;
  }
  // 向后找不到边界时再向前回退，避免中间 Chunk 因段落过短而低于最小长度。
  for (let index = targetIndex - 1; index >= startIndex + MIN_CHUNK_LENGTH - 1; index--) {
    if (isSentenceEnding(units[index])) return index + 1;
  }
  return maximumIndex;
}

/** 判断一个文本单元是否可作为 Chunk 的自然结束位置。 */
function isSentenceEnding(unit: TextUnit): boolean {
  return SENTENCE_ENDINGS.has(unit.value);
}

/** 将文本区间转换为正文和可跳转的起止 CFI。 */
function createChunk(
  units: TextUnit[],
  range: ChunkRange,
  sectionCfi: string
): { content: string; startCfi: string; endCfi: string } | null {
  const chunkUnits = units.slice(range.startIndex, range.endIndex);
  const start = chunkUnits.find(unit => unit.start)?.start ?? null;
  const end = findLastEndPosition(chunkUnits);
  const content = normalizeChunkContent(chunkUnits.map(unit => unit.value).join(''));

  if (!start || !end || !content) return null;
  return {
    content,
    startCfi: createPointCfi(sectionCfi, start),
    endCfi: createPointCfi(sectionCfi, end),
  };
}

/** 从后向前获取 Chunk 的最后一个可定位文本结束位置。 */
function findLastEndPosition(units: TextUnit[]): TextPosition | null {
  for (let index = units.length - 1; index >= 0; index--) {
    if (units[index].end) return units[index].end;
  }
  return null;
}

/** 生成某个文本位置的可导航 EPUB CFI。 */
function createPointCfi(sectionCfi: string, position: TextPosition): string {
  // foliate-js 只读取 Range 的边界字段；使用折叠 Range 可生成单个可导航位置。
  const range = {
    startContainer: position.node,
    startOffset: position.offset,
    endContainer: position.node,
    endOffset: position.offset,
    collapsed: true,
  };
  return joinIndir(sectionCfi, fromRange(range));
}

/** 清理 Chunk 内多余空白，保证持久化正文适合检索与 AI 上下文。 */
function normalizeChunkContent(content: string): string {
  return content
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
