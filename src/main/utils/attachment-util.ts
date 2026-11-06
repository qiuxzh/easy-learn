import path from 'node:path';

/** 图片最长边上限，超过则等比缩小。 */
export const MAX_IMAGE_DIMENSION = 2000;

/** 编码后 base64 体积上限（约 4.5MB，低于 Anthropic 的 5MB 限制）。 */
export const MAX_BASE64_BYTES = 4.5 * 1024 * 1024;

/** 计算 base64 编码后的字节数，用于判断是否超出接口限制。 */
export function base64Length(bytes: Buffer | Uint8Array): number {
  return Math.ceil(bytes.length / 3) * 4;
}

/** 等比缩放到最长边不超过上限；已经足够小时返回原尺寸。 */
export function scaleToFit(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };

  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 按比例缩小一档，保证宽高至少为 1。 */
export function shrinkOnce(
  width: number,
  height: number,
  ratio: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** 相对 baseDir 的路径（正斜杠），用于存库。 */
export function toPosixRelative(baseDir: string, absolutePath: string): string {
  return path.relative(baseDir, absolutePath).split(path.sep).join('/');
}

/**
 * target 是否落在 baseDir 内。
 *
 * 传 `..` 绕出目录、或指向目录本身之外的绝对路径都返回 false。
 */
export function isInsideDir(baseDir: string, target: string): boolean {
  const relative = path.relative(baseDir, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
