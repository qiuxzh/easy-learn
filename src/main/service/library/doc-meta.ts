import type { ResourceDocMeta } from '@main/contracts/resource-ocr';

/**
 * 解析 `resource.doc_meta` 里缓存的 JSON。
 *
 * @param raw 数据库里的原文
 * @returns 结构不完整或不是 JSON 时返回 null，由调用方重新计算
 */
export function parseDocMeta(raw: string | null): ResourceDocMeta | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ResourceDocMeta>;
    if (typeof value.pageCount !== 'number' || typeof value.hasTextLayer !== 'boolean') {
      return null;
    }
    return { pageCount: value.pageCount, hasTextLayer: value.hasTextLayer };
  } catch {
    return null;
  }
}

/** 把解析元数据编码成可写入 `resource.doc_meta` 的 JSON。 */
export function serializeDocMeta(meta: ResourceDocMeta): string {
  return JSON.stringify(meta);
}
