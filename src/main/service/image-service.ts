import { dialog, ipcMain, nativeImage, type NativeImage, type OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { IpcChannel } from '@shared/ipc-channels';
import type { ImageContent, ImageStoreRequest } from '@shared/types/chat';
import { Constants } from '@main/constants';
import { getMainWindow } from '@main/window';
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

/** 支持的图片类型与对应的文件扩展名 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

/** 一张待落盘的图片：处理后的字节与最终类型 */
interface PreparedImage {
  bytes: Buffer;
  mimeType: string;
}

/** 计算 base64 编码后的字节数，用于判断是否超出接口限制 */
function base64Length(bytes: Buffer): number {
  return Math.ceil(bytes.length / 3) * 4;
}

/** 按文件头识别常见图片类型，声明值缺失或不合法时使用 */
function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (bytes.toString('latin1', 0, 2) === 'BM') return 'image/bmp';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** 归一化图片类型：优先用声明值，不可用时回退到文件头嗅探 */
function resolveImageMimeType(bytes: Buffer, declared: string): string | undefined {
  const base = declared.split(';')[0].trim().toLowerCase();
  const normalized = base === 'image/jpg' ? 'image/jpeg' : base;
  if (IMAGE_EXTENSIONS[normalized]) return normalized;
  return sniffImageMime(bytes);
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

/**
 * 压缩图片：先缩尺寸，再按类型编码；超出体积上限时降质为 JPEG 并逐级缩小。
 * 无法解码的格式（如 WebP）原样保留原始字节，由模型端自行处理。
 */
function compressImage(bytes: Buffer, mimeType: string): PreparedImage {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return { bytes, mimeType };

  let current = scaleToMaxDimension(image);
  // JPEG 本就有损且体积小，直接沿用；其它格式先尝试无损 PNG
  let prepared: PreparedImage =
    mimeType === 'image/jpeg'
      ? { bytes: current.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' }
      : { bytes: current.toPNG(), mimeType: 'image/png' };
  if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

  // 无损编码超限，先降质为 JPEG
  prepared = { bytes: current.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' };
  if (base64Length(prepared.bytes) <= MAX_BASE64_BYTES) return prepared;

  // 仍然超限，逐级缩小尺寸
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

/** 校验会话 id：只允许 uuid 形态的字符，避免被拼进路径造成越权写入 */
function assertSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(`非法的会话 id: ${sessionId}`);
  }
  return sessionId;
}

/**
 * 图片服务：把聊天输入里的图片处理并落盘到 data/images/<sessionId>/ 下。
 * 会话日志与界面只保存相对 dataDir 的路径，图片本体始终留在磁盘上。
 */
export class ImageService extends BaseService {
  /** 图片根目录 */
  private readonly imageDir = Constants.imageDir;

  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Image_Store, async (_e, req: ImageStoreRequest) =>
      this.storeImages(req)
    );
  }

  /**
   * 图片入库：带 images 时处理这批字节，否则弹文件框让用户选择。
   * 返回落盘后的图片引用；单张失败只跳过该张，全部失败时抛出原因。
   *
   * TODO(孤儿图片清理)：图片一旦落盘就不再跟踪引用，以下两种情况会留下无人引用的文件：
   * - 弹框一次选中的图片超过单条消息上限，渲染层只接入前几张；
   * - 图片加入草稿后用户未发送（删除草稿、关闭标签页、关窗口）。
   * 将来可做：会话删除时连带删除 images/<sessionId>/ 目录，并扫描会话日志中不再被引用的文件。
   */
  async storeImages(req: ImageStoreRequest): Promise<ImageContent[]> {
    const sessionId = assertSessionId(req.sessionId);

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
        stored.push(this.storeOne(sessionId, source.bytes, source.mimeType));
      } catch (error) {
        firstError ??= error;
        console.error('[ImageService] 图片处理失败:', error);
      }
    }

    // 一张都没成功时把原因抛给渲染层，部分成功则返回成功的部分
    if (stored.length === 0 && firstError) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }
    return stored;
  }

  /** 处理并落盘一张图片，返回可引用的图片内容 */
  private storeOne(
    sessionId: string,
    originalBytes: Buffer,
    declaredMimeType: string
  ): ImageContent {
    const mimeType = resolveImageMimeType(originalBytes, declaredMimeType);
    if (!mimeType) {
      throw new Error('不支持的图片格式，仅支持 PNG / JPEG / WebP / GIF / BMP');
    }
    if (originalBytes.length > MAX_INPUT_BYTES) {
      throw new Error('图片文件过大，单张不能超过 20MB');
    }

    const prepared = compressImage(originalBytes, mimeType);
    const extension = IMAGE_EXTENSIONS[prepared.mimeType] ?? 'png';
    const dir = path.join(this.imageDir, sessionId);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(dir, fileName), prepared.bytes);

    return {
      type: 'image',
      path: `images/${sessionId}/${fileName}`,
      mimeType: prepared.mimeType,
    };
  }

  /** 弹出文件选择框并读取图片字节；用户取消时返回空数组 */
  private async pickFromDialog(): Promise<{ bytes: Buffer; mimeType: string }[]> {
    const options: OpenDialogOptions = {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };

    // 挂在主窗口上，弹框才会成为窗口的模态子窗并自动获得焦点
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

export const imageService = new ImageService();
