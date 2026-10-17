import { dialog, ipcMain, nativeImage, type NativeImage, type OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { IpcChannel } from '@shared/ipc-channels';
import type { AttachmentStoreRequest, ImageContent } from '@shared/types/chat';
import {
  IMAGE_EXTENSIONS,
  imageExtensionFromMimeType,
  resolveImageMimeType,
} from '@shared/utils/file-util';
import { Constants } from '@main/constants';
import { getMainWindow } from '@main/window';
import { attachmentRepo } from '@main/db/repo';
import { BaseService } from './base-service';

/** 图片最长边的上限，超过则等比缩小 */
const MAX_DIMENSION = 2000;

/** 编码后 base64 体积上限（约 4.5MB，低于 Anthropic 的 5MB 限制） */
const MAX_BASE64_BYTES = 4.5 * 1024 * 1024;

/** 单张图片原始体积上限 */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** 超出体积上限后逐级缩小的比例与最大次数 */
const SHRINK_RATIO = 0.8;
const MAX_SHRINK_ATTEMPTS = 5;

/** 降质为 JPEG 时使用的质量 */
const JPEG_QUALITY = 85;

/** 一张待落盘的图片：处理后的字节与最终类型 */
interface PreparedImage {
  bytes: Buffer;
  mimeType: string;
}

/** 计算 base64 编码后的字节数，用于判断是否超出接口限制 */
function base64Length(bytes: Buffer): number {
  return Math.ceil(bytes.length / 3) * 4;
}

/** 把图片等比缩放到最长边不超过上限 */
function scaleToMaxDimension(image: NativeImage): NativeImage {
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  if (longest <= MAX_DIMENSION) return image;

  const scale = MAX_DIMENSION / longest;
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good',
  });
}

/** 压缩图片：缩到尺寸上限内编码；仍超体积上限时降质为 JPEG 逐级缩小 */
function compressImage(bytes: Buffer, mimeType: string): PreparedImage {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return { bytes, mimeType };

  let current = scaleToMaxDimension(image);
  let prepared: PreparedImage =
    mimeType === 'image/jpeg'
      ? { bytes: current.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' }
      : { bytes: current.toPNG(), mimeType: 'image/png' };
  if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

  prepared = { bytes: current.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' };
  if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

  for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt++) {
    const { width, height } = current.getSize();
    current = current.resize({
      width: Math.max(1, Math.round(width * SHRINK_RATIO)),
      height: Math.max(1, Math.round(height * SHRINK_RATIO)),
      quality: 'good',
    });
    prepared = { bytes: current.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' };
    if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;
  }

  throw new Error('图片压缩后仍然过大，请换一张更小的图片');
}

/**
 * 附件服务：把图片落盘到 data/attachment/image/ 下并登记进 attachment 表。
 * 行与文件分开维护，删文件失败会留下无行的残留文件，没有清理流程回收它。
 */
export class AttachmentService extends BaseService {
  /** 附件根目录 */
  private readonly attachmentDir = Constants.attachmentDir;

  /** 图片文件所在的子目录名，与 type 枚举对应 */
  private static readonly IMAGE_SUBDIR = 'image';

  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Attachment_Store, async (_e, req: AttachmentStoreRequest) =>
      this.storeImages(req)
    );
  }

  /** 图片入库：带 images 时处理这批字节，否则弹文件框让用户选择；单张失败跳过，全部失败抛出原因 */
  async storeImages(req: AttachmentStoreRequest): Promise<ImageContent[]> {
    const sources = req.images?.length
      ? req.images.map(item => ({
          bytes: Buffer.from(item.bytes),
          mimeType: item.mimeType,
        }))
      : await this.pickFromDialog();
    if (sources.length === 0) return [];

    const stored: ImageContent[] = [];
    let firstError: unknown;
    for (const source of sources) {
      try {
        stored.push(await this.storeImage(source.bytes, source.mimeType));
      } catch (error) {
        firstError ??= error;
        console.error('[AttachmentService] 图片处理失败:', error);
      }
    }

    if (stored.length === 0 && firstError) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }
    return stored;
  }

  /** 把一个磁盘文件登记为新图片附件 */
  async storeFromFile(filePath: string): Promise<ImageContent> {
    const bytes = await fsp.readFile(filePath);
    const declared = mime.lookup(filePath) || '';
    return this.storeImage(bytes, declared);
  }

  /** 把已有附件的字节复制登记为一份新附件 */
  async copyAttachment(attachmentId: string): Promise<ImageContent> {
    const row = attachmentRepo.findById(attachmentId);
    if (!row) {
      throw new Error(`附件不存在: ${attachmentId}`);
    }
    const bytes = await fsp.readFile(path.resolve(Constants.dataDir, row.path));
    return this.storeImage(bytes, row.mimeType);
  }

  /** 删除若干附件：先删记录再删文件；记录不存在时跳过，文件删除失败只记日志 */
  async deleteAttachments(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;

    const rows = attachmentRepo.findByIds(attachmentIds);
    attachmentRepo.deleteByIds(attachmentIds);
    await this.deleteFiles(rows.map(row => row.path));
  }

  /** 删除附件对应的磁盘文件，路径越权或删除失败只记日志，该文件之后不再回收 */
  async deleteFiles(relativePaths: string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      const target = path.resolve(Constants.dataDir, relativePath);
      const relative = path.relative(this.attachmentDir, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        console.error('[AttachmentService] 跳过越权路径:', relativePath);
        continue;
      }
      try {
        await fsp.unlink(target);
      } catch (error) {
        console.error('[AttachmentService] 附件文件删除失败:', relativePath, error);
      }
    }
  }

  /** 按 id 查附件记录 */
  getAttachment(attachmentId: string) {
    return attachmentRepo.findById(attachmentId);
  }

  /** 处理并落盘一张图片，登记附件行，返回图片引用 */
  private async storeImage(originalBytes: Buffer, declaredMimeType: string): Promise<ImageContent> {
    const mimeType = resolveImageMimeType(originalBytes, declaredMimeType);
    if (!mimeType) {
      throw new Error('不支持的图片格式，仅支持 PNG / JPEG / WebP / GIF / BMP');
    }
    if (originalBytes.length > MAX_INPUT_BYTES) {
      throw new Error('图片文件过大，单张不能超过 20MB');
    }

    const prepared = compressImage(originalBytes, mimeType);
    const extension = imageExtensionFromMimeType(prepared.mimeType) ?? 'png';

    // 先写文件后插行，插行失败时删掉已写的文件；这步再失败，文件就留在磁盘上不再回收
    const attachmentId = crypto.randomUUID();
    const fileName = `${attachmentId}.${extension}`;
    const dir = path.join(this.attachmentDir, AttachmentService.IMAGE_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    fs.writeFileSync(target, prepared.bytes);

    try {
      attachmentRepo.insert({
        id: attachmentId,
        path: this.toRelativePath(target),
        type: 'image',
        mimeType: prepared.mimeType,
        size: prepared.bytes.length,
      });
    } catch (error) {
      try {
        fs.unlinkSync(target);
      } catch (cleanupError) {
        console.error('[AttachmentService] 残留文件清理失败:', target, cleanupError);
      }
      throw error;
    }

    return { type: 'image', attachmentId };
  }

  /** 绝对路径转相对 dataDir 的正斜杠路径 */
  private toRelativePath(absolutePath: string): string {
    return path.relative(Constants.dataDir, absolutePath).split(path.sep).join('/');
  }

  /** 弹出文件选择框并读取图片字节；用户取消时返回空数组 */
  private async pickFromDialog(): Promise<{ bytes: Buffer; mimeType: string }[]> {
    const options: OpenDialogOptions = {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片', extensions: IMAGE_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    };

    const parent = getMainWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];

    return result.filePaths.map(filePath => ({
      bytes: fs.readFileSync(filePath),
      mimeType: mime.lookup(filePath) || '',
    }));
  }
}

export const attachmentService = new AttachmentService();
