import fs from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import mime from 'mime-types';
import type { CoverImage } from '@shared/types/books';
import { IMAGE_EXTENSIONS, resolveImageExtension } from '@shared/utils/file-util';

/** 封面图片体积上限 */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

/**
 * 弹文件框选一本 EPUB/PDF。
 *
 * @returns 用户选择的绝对路径；取消选择时返回 null
 */
export async function pickBookFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '电子书', extensions: ['epub', 'pdf'] },
      { name: 'EPUB 文件', extensions: ['epub'] },
      { name: 'PDF 文件', extensions: ['pdf'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

/**
 * 弹文件框选一张封面图，只读字节不落盘。
 *
 * 渲染层拿到字节后用 Blob URL 预览，用户点击保存时才真正写盘。
 *
 * @returns 图片字节与扩展名；取消选择时返回 null
 * @throws 扩展名不支持，或文件超过体积上限
 */
export async function pickCoverImage(): Promise<CoverImage | null> {
  const result = await dialog.showOpenDialog({
    title: '选择封面图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const ext = resolveImageExtension(path.extname(filePath));
  if (!ext) {
    throw new Error('封面仅支持 PNG / JPG / WebP / GIF / BMP 格式');
  }

  const bytes = fs.readFileSync(filePath);
  if (bytes.length > MAX_COVER_BYTES) {
    throw new Error('封面图片过大，请选择 10MB 以内的图片');
  }
  return { bytes, ext };
}

/**
 * 弹文件框选多个资料文件。
 *
 * @returns 用户选择的绝对路径列表；取消选择时返回 null
 */
export async function pickLibraryFiles(): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    title: '导入资料',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '资料', extensions: ['pdf', 'epub', 'md', 'txt'] },
      { name: 'PDF 文件', extensions: ['pdf'] },
      { name: 'EPUB 文件', extensions: ['epub'] },
      { name: 'Markdown 文件', extensions: ['md'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
}

/**
 * 弹文件框选多张图片，读成字节。
 *
 * @returns 每张图片的字节与声明的 MIME；取消选择时返回 null
 */
export async function pickImages(): Promise<{ bytes: Uint8Array; mimeType: string }[] | null> {
  const result = await dialog.showOpenDialog({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: IMAGE_EXTENSIONS },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  return result.filePaths.map(filePath => ({
    bytes: fs.readFileSync(filePath),
    mimeType: mime.lookup(filePath) || '',
  }));
}
