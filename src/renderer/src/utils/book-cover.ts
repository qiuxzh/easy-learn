/**
 * 书籍封面相关的渲染层工具。
 * 书库卡片和书籍详情弹窗都要在没有封面时给出占位文案、在预览新封面时给出 MIME 类型。
 */
import { imageMimeTypeFromExtension } from '@shared/utils/file-util';

/** 用书名前 8 个字符生成默认封面文案 */
export function fallbackCoverText(name: string): string {
  const trimmed = name.trim();
  return trimmed.slice(0, 8) || '未命名';
}

/** 根据封面扩展名取 MIME 类型，未知扩展名按 PNG 处理 */
export function coverMimeType(ext: string): string {
  return imageMimeTypeFromExtension(ext) ?? 'image/png';
}
