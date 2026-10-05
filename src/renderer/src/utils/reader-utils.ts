import type { ChapterInfo } from '@shared/types/reader';
import type { TOCItem } from '@shared/types/books';
import type { FoliateBook } from '@/components/reader/foliate-types';

/**
 * 解析 pageList.label 为数字。
 * - 阿拉伯数字直接转 number
 * - 罗马数字（i / ii / iii / iv...）通过映射表转换
 * - 其他形式返回 undefined（ReadingPosition.page 不写）
 *
 * foliate 的 pageList.label 不一定都是数字：可能是 "iii"、"42"、"1-2" 等。
 * 解析失败时让 ReadingPosition.page 缺省，比塞个 NaN / 错误值更安全。
 */
export function parsePageLabel(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;

  // 阿拉伯数字（含负数 / 小数）
  const num = Number(trimmed);
  if (!Number.isNaN(num) && Number.isFinite(num)) return num;

  // 罗马数字（小写）
  const romanMap: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
    xi: 11,
    xii: 12,
    xiii: 13,
    xiv: 14,
    xv: 15,
    xvi: 16,
    xvii: 17,
    xviii: 18,
    xix: 19,
    xx: 20,
  };
  const roman = romanMap[trimmed.toLowerCase()];
  if (roman !== undefined) return roman;

  return undefined;
}

/**
 * 兜底解析当前章节信息。
 * 优先级：
 * 1. foliate relocate 给的 tocItem（label/href）
 * 2. bookEntity.tocs[index]（按 index 取，扁平目录）
 * 3. 空对象
 */
export function resolveChapter(
  index: number,
  tocItem: { label?: string; href?: string } | null | undefined,
  bookTocs: TOCItem[] | undefined,
  rawBook?: FoliateBook
): ChapterInfo {
  const matchedToc = resolveCurrentToc(index, tocItem?.href, bookTocs, rawBook);
  if (matchedToc) {
    return {
      index,
      title: matchedToc.title,
      href: matchedToc.href ?? tocItem?.href ?? '',
    };
  }
  if (tocItem?.label) {
    return { index, title: tocItem.label, href: tocItem.href ?? '' };
  }
  return { index, title: '', href: '' };
}

export function resolveTocIdByHref(
  bookTocs: TOCItem[] | undefined,
  href: string | undefined
): string | null {
  const matched = findTocByHref(bookTocs, href);
  return matched?.id ?? null;
}

function resolveCurrentToc(
  index: number,
  href: string | undefined,
  bookTocs: TOCItem[] | undefined,
  rawBook?: FoliateBook
): TOCItem | null {
  const matchedByHref = findTocByHref(bookTocs, href);
  if (matchedByHref) return matchedByHref;
  if (!bookTocs?.length || !rawBook?.resolveHref) return null;
  for (const toc of flattenTocs(bookTocs)) {
    if (!toc.href) continue;
    const resolved = rawBook.resolveHref(toc.href);
    if (resolved?.index === index) {
      return toc;
    }
  }
  return null;
}

function findTocByHref(bookTocs: TOCItem[] | undefined, href: string | undefined): TOCItem | null {
  if (!bookTocs?.length || !href) return null;
  const normalizedHref = normalizeHref(href);
  for (const toc of flattenTocs(bookTocs)) {
    if (!toc.href) continue;
    if (toc.href === href) return toc;
    if (normalizeHref(toc.href) === normalizedHref) {
      return toc;
    }
  }
  return null;
}

function flattenTocs(bookTocs: TOCItem[]): TOCItem[] {
  const result: TOCItem[] = [];
  for (const toc of bookTocs) {
    result.push(toc);
    if (toc.subitems?.length) {
      result.push(...flattenTocs(toc.subitems));
    }
  }
  return result;
}

function normalizeHref(href: string): string {
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}
