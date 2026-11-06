import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import Jimp from 'jimp';
import type { Paths } from '@main/paths';
import {
  MAX_BASE64_BYTES,
  MAX_IMAGE_DIMENSION,
  base64Length,
  isInsideDir,
  scaleToFit,
  shrinkOnce,
  toPosixRelative,
} from '@main/utils/attachment-util';

/** 单张图片逐级缩小的比例与最大次数。 */
const SHRINK_RATIO = 0.8;
const MAX_SHRINK_ATTEMPTS = 5;

/** 降质为 JPEG 时使用的质量。 */
const JPEG_QUALITY = 85;

/** 一张待落盘的图片：处理后的字节与最终类型。 */
export interface PreparedImage {
  bytes: Buffer;
  mimeType: string;
}

/** 附件的文件与图片编码。只碰磁盘与图片编解码，不碰数据库。 */
export interface AttachmentStore {
  /**
   * 写一张图片到 `attachment/<subdir>/<fileName>`。
   *
   * @returns 相对数据目录的正斜杠路径，供写库使用
   */
  writeImage(subdir: string, fileName: string, bytes: Buffer): string;

  /** 删除若干相对路径对应的文件；越权路径与删除失败只记日志，不抛出。 */
  remove(relativePaths: string[]): void;

  /** 按相对路径读文件；越权路径抛错。 */
  read(relativePath: string): Promise<Buffer>;

  /** 按相对路径同步读出 base64；越权路径抛错。 */
  readBase64(relativePath: string): string;

  /** 按绝对路径读用户选择的文件，并按其扩展名推断 MIME。 */
  readFile(absolutePath: string): Promise<{ bytes: Buffer; mimeType: string }>;

  /** 压缩图片：缩到尺寸上限内编码；仍超体积上限时降质为 JPEG 逐级缩小。 */
  compress(bytes: Buffer, mimeType: string): Promise<PreparedImage>;
}

/**
 * 创建附件存储。
 *
 * @param paths 路径集合；数据目录用于相对路径换算，附件目录用于越权校验
 */
export function createAttachmentStore(paths: Paths): AttachmentStore {
  const dataDir = paths.dataDir;
  const attachmentDir = paths.attachmentDir;

  const encode = async (
    base: Jimp,
    width: number,
    height: number,
    mimeType: string
  ): Promise<PreparedImage> => {
    const image = base.clone().resize(width, height);
    if (mimeType === 'image/jpeg') image.quality(JPEG_QUALITY);
    return {
      bytes: await image.getBufferAsync(mimeType),
      mimeType,
    };
  };

  return {
    writeImage: (subdir, fileName, bytes) => {
      const dir = path.join(attachmentDir, subdir);
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, fileName);
      fs.writeFileSync(target, bytes);
      return toPosixRelative(dataDir, target);
    },

    remove: relativePaths => {
      for (const relativePath of relativePaths) {
        const target = path.resolve(dataDir, relativePath);
        if (!isInsideDir(attachmentDir, target)) {
          console.error('[AttachmentStore] 跳过越权路径:', relativePath);
          continue;
        }
        try {
          fs.unlinkSync(target);
        } catch (error) {
          console.error('[AttachmentStore] 附件文件删除失败:', relativePath, error);
        }
      }
    },

    read: async relativePath => {
      const target = path.resolve(dataDir, relativePath);
      if (!isInsideDir(attachmentDir, target)) {
        throw new Error(`附件路径越权: ${relativePath}`);
      }
      return fsp.readFile(target);
    },

    readBase64: relativePath => {
      const target = path.resolve(dataDir, relativePath);
      if (!isInsideDir(attachmentDir, target)) {
        throw new Error(`附件路径越权: ${relativePath}`);
      }
      return fs.readFileSync(target).toString('base64');
    },

    readFile: async absolutePath => ({
      bytes: await fsp.readFile(absolutePath),
      mimeType: mime.lookup(absolutePath) || '',
    }),

    compress: async (bytes, mimeType) => {
      let base: Jimp;
      try {
        base = await Jimp.read(bytes);
      } catch {
        // 解码不出图片时按原样存储，与旧实现的降级行为一致
        return { bytes, mimeType };
      }
      const { width, height } = base.bitmap;
      if (!width || !height) return { bytes, mimeType };

      const scaled = scaleToFit(width, height, MAX_IMAGE_DIMENSION);
      const targetType = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      let prepared = await encode(base, scaled.width, scaled.height, targetType);
      if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

      // 超过体积上限：统一降为 JPEG
      prepared = await encode(base, scaled.width, scaled.height, 'image/jpeg');
      if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

      let { width: targetWidth, height: targetHeight } = scaled;
      for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt++) {
        ({ width: targetWidth, height: targetHeight } = shrinkOnce(
          targetWidth,
          targetHeight,
          SHRINK_RATIO
        ));
        prepared = await encode(base, targetWidth, targetHeight, 'image/jpeg');
        if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;
      }

      throw new Error('图片压缩后仍然过大，请换一张更小的图片');
    },
  };
}
