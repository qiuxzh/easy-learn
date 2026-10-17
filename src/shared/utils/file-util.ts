/** 去掉文件开头可能存在的 BOM。 */
export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** 支持的图片扩展名（不带点）。文件选择框、格式校验、错误提示都从这里取。 */
export const IMAGE_EXTENSIONS: string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

/** 扩展名（不带点）到图片 MIME 类型；jpg 与 jpeg 指向同一个类型。 */
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** 图片 MIME 类型到落盘扩展名。一个类型只留一个规范扩展名（jpeg 而非 jpg），文件名才稳定。 */
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

/** 去掉扩展名前导点并统一小写。 */
function normalizeImageExtension(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase();
}

/** 归一化扩展名并确认受支持；不受支持时返回 null。 */
export function resolveImageExtension(ext: string): string | null {
  const normalized = normalizeImageExtension(ext);
  return IMAGE_MIME_BY_EXTENSION[normalized] ? normalized : null;
}

/** 扩展名（可带点）是否属于受支持的图片格式。 */
export function isSupportedImageExtension(ext: string): boolean {
  return resolveImageExtension(ext) !== null;
}

/** 扩展名（可带点）对应的图片 MIME 类型；不受支持时返回 undefined。 */
export function imageMimeTypeFromExtension(ext: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[normalizeImageExtension(ext)];
}

/** 图片 MIME 类型对应的落盘扩展名；不受支持时返回 undefined。 */
export function imageExtensionFromMimeType(mimeType: string): string | undefined {
  return IMAGE_EXTENSION_BY_MIME[mimeType];
}

/**
 * 按文件头识别图片类型，声明值缺失或不合法时使用。
 * 逐字节比较而不是 Buffer 解码，主进程与渲染进程都能跑。
 */
export function sniffImageMimeType(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * 归一化图片 MIME 类型：优先用声明值，不可用时回退到文件头嗅探。
 * 声明值可能带参数（如 `image/jpeg; charset=...`），比较前先去掉。
 */
export function resolveImageMimeType(bytes: Uint8Array, declared: string): string | undefined {
  const base = declared.split(';')[0].trim().toLowerCase();
  const normalized = base === 'image/jpg' ? 'image/jpeg' : base;
  return IMAGE_EXTENSION_BY_MIME[normalized] ? normalized : sniffImageMimeType(bytes);
}
