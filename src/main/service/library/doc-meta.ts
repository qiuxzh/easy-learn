import type { ResourceRepo } from '@main/contracts/resource-repo';
import {
  DOC_META_SCHEMA_VERSION,
  PDF_TOC_PARSER_VERSION,
  RESOURCE_FORMATS,
  type PdfDocMeta,
  type PdfToc,
  type PdfTocItem,
  type ResourceDocMeta,
  type ResourceFormat,
} from '@shared/types/library';

/**
 * `resource.doc_meta` 的读写收敛点。
 *
 * 所有业务方都不要再直接 `setDocMeta`：它是整值覆盖，OCR 链补一次页数就会把
 * 导入时存好的 toc 冲掉。写一律走 {@link patchPdfDocMeta} 的读-改-写。
 */

function isResourceFormat(value: unknown): value is ResourceFormat {
  return typeof value === 'string' && RESOURCE_FORMATS.some(format => format === value);
}

/** 目录形状只做浅校验；解析算法版本不一致时整个作废，让前端重新解析。 */
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
 * 只服务 PDF：其它格式的元数据目前只有 format / schemaVersion，没有可补的字段，
 * 等到它们各自有内容时再按格式分派，不要现在就把这里做成通用的。
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
