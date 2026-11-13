import type { ResourceRepo } from '@main/contracts/resource-repo';
import {
  DOC_META_SCHEMA_VERSION,
  EPUB_STRUCTURE_PARSER_VERSION,
  PDF_TOC_PARSER_VERSION,
  RESOURCE_FORMATS,
  type EpubDocMeta,
  type EpubSectionMeta,
  type EpubTocItem,
  type PdfDocMeta,
  type PdfToc,
  type PdfTocItem,
  type ResourceDocMeta,
  type ResourceFormat,
} from '@shared/types/library';

/**
 * `resource.doc_meta` 的读写与校验收敛点。
 *
 * `setDocMeta` 是整值覆盖：局部更新必须读-改-写，否则会把另一部分字段冲掉。
 * PDF 的局部更新走 {@link patchPdfDocMeta}；各格式的元数据由各自的读取模块解析。
 */

function isResourceFormat(value: unknown): value is ResourceFormat {
  return typeof value === 'string' && RESOURCE_FORMATS.some(format => format === value);
}

/** 目录形状只做浅校验；解析算法版本不一致时整个作废，让读取侧重解析。 */
function parsePdfToc(value: unknown): PdfToc | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.parserVersion !== PDF_TOC_PARSER_VERSION) return null;
  if (!Array.isArray(candidate.items)) return null;
  return {
    items: candidate.items as PdfTocItem[],
    parserVersion: PDF_TOC_PARSER_VERSION,
  };
}

/** EPUB 目录逐项校验；任一项不合法时整棵树作废。 */
function parseEpubToc(value: unknown): EpubTocItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: EpubTocItem[] = [];
  for (const raw of value) {
    const item = parseEpubTocItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function parseEpubTocItem(value: unknown): EpubTocItem | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string') return null;
  if (typeof candidate.title !== 'string') return null;
  if (typeof candidate.level !== 'number') return null;
  if (candidate.href !== undefined && typeof candidate.href !== 'string') return null;

  const item: EpubTocItem = {
    id: candidate.id,
    title: candidate.title,
    level: candidate.level,
  };
  if (typeof candidate.href === 'string') item.href = candidate.href;

  if (candidate.subitems !== undefined) {
    const subitems = parseEpubToc(candidate.subitems);
    if (!subitems) return null;
    if (subitems.length > 0) item.subitems = subitems;
  }
  return item;
}

/** EPUB spine 列表逐项校验；任一项不合法时整体作废。 */
function parseEpubSections(value: unknown): EpubSectionMeta[] | null {
  if (!Array.isArray(value)) return null;
  const sections: EpubSectionMeta[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.index !== 'number') return null;
    if (typeof candidate.href !== 'string') return null;
    if (typeof candidate.title !== 'string') return null;
    if (candidate.sizeBytes !== null && typeof candidate.sizeBytes !== 'number') return null;
    if (typeof candidate.linear !== 'boolean') return null;

    sections.push({
      index: candidate.index,
      href: candidate.href,
      title: candidate.title,
      sizeBytes: candidate.sizeBytes ?? null,
      linear: candidate.linear,
    });
  }
  return sections;
}

/**
 * 解析缓存 JSON，按 `format` 判别校验。
 *
 * 返回 null 表示脏缓存，调用方应重新计算：老记录没有 format 字段、
 * 结构版本落后、或字段类型不对都会落到这里。
 */
export function parseDocMeta(raw: string | null): ResourceDocMeta | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!isResourceFormat(value.format)) return null;
    if (value.schemaVersion !== DOC_META_SCHEMA_VERSION) return null;

    if (value.format === 'pdf') {
      if (typeof value.pageCount !== 'number' || typeof value.hasTextLayer !== 'boolean') {
        return null;
      }
      const pageLabels =
        Array.isArray(value.pageLabels) &&
        value.pageLabels.every(label => typeof label === 'string')
          ? (value.pageLabels as string[])
          : null;
      return {
        format: 'pdf',
        schemaVersion: DOC_META_SCHEMA_VERSION,
        pageCount: value.pageCount,
        hasTextLayer: value.hasTextLayer,
        toc: parsePdfToc(value.toc),
        pageLabels,
      };
    }

    if (value.format === 'epub') {
      const parserVersion =
        value.parserVersion === EPUB_STRUCTURE_PARSER_VERSION ? EPUB_STRUCTURE_PARSER_VERSION : 0;
      return {
        format: 'epub',
        schemaVersion: DOC_META_SCHEMA_VERSION,
        toc: parserVersion === 0 ? null : parseEpubToc(value.toc),
        sections: parserVersion === 0 ? null : parseEpubSections(value.sections),
        parserVersion,
      };
    }

    return { format: value.format, schemaVersion: DOC_META_SCHEMA_VERSION };
  } catch {
    return null;
  }
}

/** OCR 链只处理 PDF，用它避开判别联合里其它分支没有页数字段的问题。 */
export function parsePdfDocMeta(raw: string | null): PdfDocMeta | null {
  const meta = parseDocMeta(raw);
  return meta?.format === 'pdf' ? meta : null;
}

/** EPUB 读取链用它避开判别联合里其它分支没有目录字段的问题。 */
export function parseEpubDocMeta(raw: string | null): EpubDocMeta | null {
  const meta = parseDocMeta(raw);
  return meta?.format === 'epub' ? meta : null;
}

/** 把解析元数据编码成可写入 `resource.doc_meta` 的 JSON。 */
export function serializeDocMeta(meta: ResourceDocMeta): string {
  return JSON.stringify(meta);
}

const EMPTY_PDF_DOC_META: PdfDocMeta = {
  format: 'pdf',
  schemaVersion: DOC_META_SCHEMA_VERSION,
  pageCount: 0,
  hasTextLayer: false,
  toc: null,
  pageLabels: null,
};

/**
 * 局部更新 PDF 元数据：读-改-写，保留已有的 toc / pageLabels。
 *
 * 缓存不存在或是旧格式时，按空 PDF 元数据起底再补 patch，保证写进去的仍是完整结构。
 * 只处理 PDF；EPUB 的目录与 section 一起整体写入，不做逐字段 patch。
 */
export function patchPdfDocMeta(
  repo: ResourceRepo,
  id: string,
  patch: Partial<PdfDocMeta>
): PdfDocMeta {
  const current = parsePdfDocMeta(repo.findDocMeta(id));
  const next: PdfDocMeta = {
    ...(current ?? EMPTY_PDF_DOC_META),
    ...patch,
    format: 'pdf',
    schemaVersion: DOC_META_SCHEMA_VERSION,
  };
  repo.setDocMeta(id, serializeDocMeta(next));
  return next;
}
