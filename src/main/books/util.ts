import type { FoliateBook, FoliateDestination } from '@/components/reader/foliate-types';
import type { BookRow } from '../db/schema';
import type { BookDoc, TOCItem } from '@shared/types/books';
import { extractMathFormula, formatMathFormula, isDisplayMath, isMathElement } from './formula';

const TEXTLESS_TAGS = new Set(['script', 'style', 'noscript']);
const BLOCK_TAGS = new Set([
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

interface TextNodeLike {
  nodeType: number;
  nodeName?: string | null;
  nodeValue?: string | null;
  firstChild?: TextNodeLike | null;
  nextSibling?: TextNodeLike | null;
  previousSibling?: TextNodeLike | null;
  parentNode?: TextNodeLike | null;
  documentElement?: TextNodeLike | null;
  removeChild?: (child: TextNodeLike) => TextNodeLike;
}

/** 将 DB 行转换为渲染端 Book 实体 */
export function toBook(row: BookRow): BookDoc {
  return {
    id: row.id,
    booksName: row.booksName,
    booksType: row.booksType,
    coverUrl: row.coverImg ? `app:///${row.coverImg}` : null,
    totalPages: row.totalPages,
    totalChapters: row.totalChapters,
    description: row.description,
    author: row.author,
    createdAt: row.createdAt,
  };
}

export function findTocById(items: TOCItem[], tocId: string): TOCItem | null {
  for (const item of items) {
    if (item.id === tocId) return item;
    const found = item.subitems?.length ? findTocById(item.subitems, tocId) : null;
    if (found) return found;
  }
  return null;
}

export function toResultToc(toc: TOCItem): Pick<TOCItem, 'id' | 'title' | 'level' | 'href'> {
  return {
    id: toc.id,
    title: toc.title,
    level: toc.level,
    href: toc.href,
  };
}

/** 将分段读取的起始位置归一化为非负整数，非法值回退到默认值。 */
export function clampReadOffset(offset: number | undefined, defaultOffset: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) {
    return defaultOffset;
  }
  return Math.trunc(offset);
}

/** 将分段读取长度归一化为正整数，并限制在工具允许的最大值内。 */
export function clampReadLength(
  length: number | undefined,
  defaultLength: number,
  maxLength: number
): number {
  if (length === undefined || !Number.isFinite(length) || length <= 0) {
    return defaultLength;
  }
  return Math.min(Math.trunc(length), maxLength);
}

/**
 * 在扁平化的 TOC 里找「阅读顺序里的下一个同级或更高级目录项」。
 *
 * 之所以不看 href 指向哪一节：多个目录项常常挤在同一个 xhtml 里，
 * 只有靠目录层级才能判断当前这一讲的正文在哪里结束。
 * （用「同级或更高级」而不是「同级」——若当前是末级子项，
 * 下一个同级项不存在时应该收到父级节点的结束位置，而不是继续往下钻。）
 */
export function findNextTocItem(tocs: TOCItem[], tocId: string): TOCItem | null {
  const flat = flattenTocs(tocs);
  const current = flat.findIndex(item => item.id === tocId);
  if (current < 0) return null;

  const { level } = flat[current];
  for (let i = current + 1; i < flat.length; i++) {
    if (flat[i].level <= level) return flat[i];
  }
  return null;
}

/**
 * 取出 href 锚点指向的元素。
 * foliate-js 的 anchor 在 href 不带 #fragment 时是 `() => 0`（数字），
 * 这里做类型判定，取不到元素一律返回 null 交给调用方降级。
 */
export function resolveAnchorElement(
  anchor: FoliateDestination['anchor'] | undefined,
  doc: Document
): Element | null {
  const node = anchor?.(doc) as unknown as TextNodeLike | null | undefined;
  return node && node.nodeType === 1 ? (node as unknown as Element) : null;
}

/**
 * 解析「下一目录项」在本节内的锚点元素（作为当前章节正文的结束边界）。
 * 下一项目不在同一节（跨物理文件）或自身没有锚点时返回 null，
 * 调用方应退化成「读到本节末尾」。
 */
export function resolveNextTocAnchorElement(
  book: FoliateBook,
  nextToc: TOCItem | null,
  sectionIndex: number,
  doc: Document
): Element | null {
  if (!nextToc?.href) return null;
  const target = book.resolveHref?.(nextToc.href);
  if (!target || target.index !== sectionIndex) return null;
  return resolveAnchorElement(target.anchor, doc);
}

/**
 * 把整篇正文裁成目录项自己的范围：`from` 之前、`to` 及其之后的节点全部摘掉。
 *
 * 主进程用的 xmldom 没有 Range / TreeWalker，无法"就地取区间"，
 * 所以这里直接改树——之所以安全，是因为 `section.createDocument()`
 * 每次调用都重新解析一份新的 Document，裁掉的不是共享数据。
 *
 * 越界保护：先摘 `from` 之前的部分，若 `to` 已经不在树上（两个锚点顺序颠倒），
 * 就放弃摘 `to` 之后的部分，宁可多读也不要读出空文本。
 *
 * @param from 起点元素，含其自身（null 表示从节首开始）
 * @param to   终点元素，不含其自身（null 表示读到底）
 */
export function clipDocumentRange(doc: Document, from: Element | null, to: Element | null): void {
  const root = ((doc as unknown as TextNodeLike).documentElement ?? doc) as unknown as TextNodeLike;

  if (from) {
    trimBefore(root, from as unknown as TextNodeLike);
  }
  if (to && to !== from && isUnderRoot(root, to as unknown as TextNodeLike)) {
    trimFrom(root, to as unknown as TextNodeLike);
  }
}

export function extractSectionText(doc: Document): string {
  const root = ((doc as unknown as TextNodeLike).documentElement ?? doc) as unknown as TextNodeLike;
  const text = collectNodeText(root);
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flattenTocs(items: TOCItem[]): TOCItem[] {
  const result: TOCItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.subitems?.length) {
      result.push(...flattenTocs(item.subitems));
    }
  }
  return result;
}

/** 摘掉 node 之前的所有节点，保留 node 及其子树；逐级向上处理祖先的前置兄弟。 */
function trimBefore(root: TextNodeLike, node: TextNodeLike): void {
  for (let cur: TextNodeLike | null = node; cur && cur !== root; cur = cur.parentNode ?? null) {
    const parent: TextNodeLike | null = cur.parentNode ?? null;
    if (!parent?.removeChild) return;
    // 被摘掉的节点会被置空 nextSibling/previousSibling，先把指针存下来再删
    let prev: TextNodeLike | null = cur.previousSibling ?? null;
    while (prev) {
      const following: TextNodeLike | null = prev.previousSibling ?? null;
      parent.removeChild(prev);
      prev = following;
    }
  }
}

/** 摘掉 node 自身及其之后的所有节点；逐级向上处理祖先的后置兄弟。 */
function trimFrom(root: TextNodeLike, node: TextNodeLike): void {
  let cur: TextNodeLike | null = node;
  while (cur && cur !== root) {
    const parent: TextNodeLike | null = cur.parentNode ?? null;
    if (!parent?.removeChild) return;
    let next: TextNodeLike | null = cur.nextSibling ?? null;
    while (next) {
      const following: TextNodeLike | null = next.nextSibling ?? null;
      parent.removeChild(next);
      next = following;
    }
    if (cur === node) parent.removeChild(cur);
    cur = parent;
  }
}

/** node 是否仍挂在 root 子树内（xmldom 没有 isConnected，只能顺着 parentNode 往上走） */
function isUnderRoot(root: TextNodeLike, node: TextNodeLike): boolean {
  for (let cur: TextNodeLike | null = node; cur; cur = cur.parentNode ?? null) {
    if (cur === root) return true;
  }
  return false;
}

function collectNodeText(node: TextNodeLike | null | undefined): string {
  if (!node) return '';
  if (node.nodeType === 3 || node.nodeType === 4) {
    return node.nodeValue ?? '';
  }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) {
    return '';
  }

  const tagName = node.nodeName?.toLowerCase() ?? '';
  if (TEXTLESS_TAGS.has(tagName)) return '';
  if (tagName === 'br') return '\n';
  if (isMathElement(tagName)) {
    const latex = extractMathFormula(node);
    if (latex) {
      const formula = formatMathFormula(node, latex);
      return isDisplayMath(node) ? `\n${formula}\n` : formula;
    }
  }

  let content = '';
  for (let child = node.firstChild ?? null; child; child = child.nextSibling ?? null) {
    content += collectNodeText(child);
  }

  if (BLOCK_TAGS.has(tagName)) {
    return `\n${content}\n`;
  }
  return content;
}
