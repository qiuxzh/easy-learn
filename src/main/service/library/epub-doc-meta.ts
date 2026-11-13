import fs from 'node:fs';
import path from 'node:path';
import { initFoliatePolyfill } from '@main/service/etl/foliate-polyfill';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';
import {
  DOC_META_SCHEMA_VERSION,
  EPUB_STRUCTURE_PARSER_VERSION,
  type EpubDocMeta,
  type EpubSectionMeta,
  type EpubTocItem,
} from '@shared/types/library';

/** 解析结果里的目录节点；只声明本模块用到的字段，避免把书籍域类型带进资料域。 */
interface ParsedTocNode {
  id: string;
  title: string;
  level: number;
  href?: string;
  subitems?: ParsedTocNode[];
}

/** 解析结果里的 section；只取生成元数据需要的字段。 */
interface SectionSource {
  id: string;
  linear?: string;
  size?: number;
  createDocument?: () => Document | Promise<Document>;
}

/** 标题最长保留的字符数。 */
const MAX_TITLE_LENGTH = 120;

/**
 * 解析 EPUB 的结构元数据：原书目录树 + spine 阅读单元。
 *
 * 目录直接取 foliate-js 的解析结果；section 标题按第一个标题、`<title>`、文件名、
 * 第 N 节的先后顺序取，单节标题解析失败不影响整本书。
 *
 * @param filePath EPUB 的绝对路径
 * @returns 目录树与按 spine 顺序排列的阅读单元
 * @throws 文件读取失败、EPUB 损坏或加密时抛出
 */
export async function readEpubDocMeta(filePath: string): Promise<EpubDocMeta> {
  initFoliatePolyfill();
  const buffer = await fs.promises.readFile(filePath);
  const parsed = await parseEpubFromBuffer(buffer, { copyBlob: true });
  const bookTitle = normalizeTitle(parsed.metadata.title);
  const toc = toEpubToc(parsed.tocs);
  const sections: EpubSectionMeta[] = [];

  for (const [index, section] of parsed.rawBook.sections.entries()) {
    sections.push({
      index,
      href: section.id,
      title: await readSectionTitle(section, bookTitle, index),
      sizeBytes: section.size ?? null,
      linear: section.linear !== 'no',
    });
  }

  return {
    format: 'epub',
    schemaVersion: DOC_META_SCHEMA_VERSION,
    toc,
    sections,
    parserVersion: EPUB_STRUCTURE_PARSER_VERSION,
  };
}

/** 把解析出的目录节点收敛成资料域的纯数据。 */
function toEpubToc(items: readonly ParsedTocNode[]): EpubTocItem[] {
  return items.map(item => {
    const next: EpubTocItem = {
      id: item.id,
      title: item.title,
      level: item.level,
    };
    if (item.href) next.href = item.href;
    if (item.subitems?.length) next.subitems = toEpubToc(item.subitems);
    return next;
  });
}

/** 取一节的展示标题；任何一步失败都回落到下一档。 */
async function readSectionTitle(
  section: SectionSource,
  bookTitle: string,
  index: number
): Promise<string> {
  if (section.createDocument) {
    try {
      const doc = await section.createDocument();
      const heading = firstHeadingText(doc);
      if (heading) return heading;

      const docTitle = elementText(doc.querySelector('title'));
      if (docTitle && docTitle !== bookTitle) return docTitle;
    } catch {
      // 单节解析失败不阻断整本书；继续用文件名兜底
    }
  }

  const fileName = path.posix.basename(section.id);
  const stem = fileName.replace(/\.[^.]+$/, '');
  return normalizeTitle(stem) || `第 ${index + 1} 节`;
}

function firstHeadingText(doc: Document): string {
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const text = elementText(doc.querySelector(tag));
    if (text) return text;
  }
  return '';
}

/** 读元素文本并归一化；xmldom 没有 innerText 时回落到 textContent。 */
function elementText(element: Element | null): string {
  if (!element) return '';
  const inner = (element as unknown as { innerText?: string }).innerText;
  return normalizeTitle(inner ?? element.textContent ?? '');
}

/** 空白归一化并限制长度，避免标题撑爆元数据。 */
function normalizeTitle(value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE_LENGTH ? text.slice(0, MAX_TITLE_LENGTH) : text;
}
