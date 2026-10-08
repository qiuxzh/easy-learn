import { extractMathFormula, formatMathFormula, isDisplayMath, isMathElement } from '../../formula';
import type { TextUnit } from './types';

/**
 * HTML 系文档（EPUB 的 xhtml、HTML 文件）的「DOM → 文本」知识集中在本文件。
 *
 * 这里提供两种遍历，差别只在空白与段落间距策略，消费方按用途各取其一：
 * - collectTextUnits：切分用。逐码点保留锚点，文本节点内的软换行压成空格
 *   （避免换行成为分片边界），块级元素之间只留一个换行。
 * - collectPlainText：正文提取用。不记锚点，保留软换行，块级元素之间留空行。
 */

/** xmldom 未暴露全局 Node 构造器，因此使用 DOM 标准节点类型常量。 */
const TEXT_NODE_TYPE = 3;
const CDATA_NODE_TYPE = 4;
const ELEMENT_NODE_TYPE = 1;
const DOCUMENT_NODE_TYPE = 9;
const FRAGMENT_NODE_TYPE = 11;

/** 块级元素：前后需要换行，以保留段落语义。 */
export const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'br',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
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

/** 不可检索元素：整棵子树都不进入正文。 */
export const TEXTLESS_TAGS = new Set([
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

/** DOM 文本位置锚点：指向某个文本节点及其字符偏移。 */
export interface DomAnchor {
  /** 锚点所在的文本节点 */
  node: Node;
  /** 文本节点内的字符偏移 */
  offset: number;
}

/**
 * 遍历 DOM，把正文转换为保留原始节点位置的文本单元。
 * @param root 输入：遍历起点，通常是 documentElement
 * @returns 输出：按阅读顺序排列的文本单元，每个单元带定位锚点；
 *   段落换行等为保留语义插入的单元没有锚点，start / end 为 null
 */
export function collectTextUnits(root: Node): TextUnit[] {
  const units: TextUnit[] = [];

  /** 递归收集当前节点及其子节点中的可检索正文。 */
  const visit = (node: Node): void => {
    if (node.nodeType === TEXT_NODE_TYPE || node.nodeType === CDATA_NODE_TYPE) {
      appendTextUnits(units, node);
      return;
    }
    if (
      node.nodeType !== ELEMENT_NODE_TYPE &&
      node.nodeType !== DOCUMENT_NODE_TYPE &&
      node.nodeType !== FRAGMENT_NODE_TYPE
    ) {
      return;
    }

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
 * 遍历 DOM 提取纯文本，不做空白清理，保留文本节点内的换行。
 * 调用方（extractSegmentText）负责后续的空白归一化。
 * @param root 遍历起点，通常是 documentElement
 */
export function collectPlainText(root: Node): string {
  if (root.nodeType === TEXT_NODE_TYPE || root.nodeType === CDATA_NODE_TYPE) {
    return root.nodeValue ?? '';
  }
  if (
    root.nodeType !== ELEMENT_NODE_TYPE &&
    root.nodeType !== DOCUMENT_NODE_TYPE &&
    root.nodeType !== FRAGMENT_NODE_TYPE
  ) {
    return '';
  }

  const tagName = root.nodeName.toLowerCase();
  if (TEXTLESS_TAGS.has(tagName)) return '';
  if (tagName === 'br') return '\n';
  if (isMathElement(tagName)) {
    const latex = extractMathFormula(root as Element);
    if (latex) {
      const formula = formatMathFormula(root as Element, latex);
      return isDisplayMath(root as Element) ? `\n${formula}\n` : formula;
    }
  }

  let content = '';
  for (let child = root.firstChild; child; child = child.nextSibling) {
    content += collectPlainText(child);
  }

  return BLOCK_TAGS.has(tagName) ? `\n${content}\n` : content;
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

/** 获取公式子树中的首个文本位置，用于生成起始锚点。 */
function findFirstTextPosition(node: Node): DomAnchor | null {
  if (node.nodeType === TEXT_NODE_TYPE && node.nodeValue) {
    return { node, offset: 0 };
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const position = findFirstTextPosition(child);
    if (position) return position;
  }
  return null;
}

/** 获取公式子树中的末尾文本位置，用于生成结束锚点。 */
function findLastTextPosition(node: Node): DomAnchor | null {
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
    const start = { node, offset };
    const end = { node, offset: offset + length };

    if (/\s/u.test(value)) {
      appendWhitespace(units, start, end);
    } else {
      units.push({ value, start, end });
    }
    offset += length;
  }
}

/** 追加空白单元，并合并相邻空白以稳定分片字符长度。 */
function appendWhitespace(units: TextUnit[], start: DomAnchor, end: DomAnchor): void {
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

/** 移除单元开头和末尾无定位价值的换行。 */
function trimBoundaryBreaks(units: TextUnit[]): TextUnit[] {
  let start = 0;
  let end = units.length;

  while (start < end && units[start].value === '\n') start++;
  while (end > start && units[end - 1].value === '\n') end--;
  return units.slice(start, end);
}
