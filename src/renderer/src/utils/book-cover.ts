/**
 * 书籍封面相关的渲染层工具。
 * 书库卡片和书籍详情弹窗都要在没有封面时给出占位文案、在预览新封面时给出 MIME 类型。
 */

/** 封面扩展名到 MIME 类型的映射，用于把封面字节包成可预览的 Blob */
const COVER_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** 用书名前 8 个字符生成默认封面文案 */
export function fallbackCoverText(name: string): string {
  const trimmed = name.trim();
  return trimmed.slice(0, 8) || '未命名';
}

/** 根据封面扩展名取 MIME 类型，未知扩展名按 PNG 处理 */
export function coverMimeType(ext: string): string {
  return COVER_MIME_TYPES[ext.replace(/^\./, '').toLowerCase()] ?? 'image/png';
}
