import { randomUUID } from 'node:crypto';
import type { ImageContent } from '@shared/types/chat';
import { imageExtensionFromMimeType, resolveImageMimeType } from '@shared/utils/file-util';
import type { AttachmentEntity } from '@main/contracts/attachment';
import type { AttachmentRepo } from '@main/contracts/attachment-repo';
import type { AttachmentStore } from '@main/infra/attachment-store';

/** 图片文件所在的子目录名，与 type 枚举对应。 */
const IMAGE_SUBDIR = 'image';

/** 单张图片原始体积上限。 */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * 校验图片输入，返回最终采用的 MIME 类型。
 *
 * 声明的类型不可信，以文件头为准。
 *
 * @throws 格式不支持，或原始体积超过上限
 */
function validateImageInput(bytes: Buffer, declaredMimeType: string): string {
  const mimeType = resolveImageMimeType(bytes, declaredMimeType);
  if (!mimeType) {
    throw new Error('不支持的图片格式，仅支持 PNG / JPEG / WebP / GIF / BMP');
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error('图片文件过大，单张不能超过 20MB');
  }
  return mimeType;
}

/** 一张待登记的图片输入。 */
export interface ImageInput {
  bytes: Uint8Array;
  mimeType: string;
}

/** 创建 AttachmentService 所需的依赖。 */
export interface AttachmentServiceDeps {
  /** 附件表仓储。 */
  attachmentRepo: AttachmentRepo;
  /** 文件写入、读取与图片压缩。 */
  store: AttachmentStore;
}

/**
 * 附件服务：把图片登记进 attachment 表并落盘。
 * 行与文件分开维护，删文件失败会留下无行的残留文件，没有清理流程回收它。
 */
export class AttachmentService {
  private readonly attachmentRepo: AttachmentRepo;
  private readonly store: AttachmentStore;

  constructor(deps: AttachmentServiceDeps) {
    this.attachmentRepo = deps.attachmentRepo;
    this.store = deps.store;
  }

  /** 图片入库：逐张处理，单张失败跳过，全部失败抛出第一个原因。 */
  async storeImages(images: readonly ImageInput[]): Promise<ImageContent[]> {
    if (images.length === 0) return [];

    const stored: ImageContent[] = [];
    let firstError: unknown;
    for (const image of images) {
      try {
        stored.push(await this.storeImage(image.bytes, image.mimeType));
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

  /** 把一个磁盘文件登记为新图片附件。 */
  async storeFromFile(filePath: string): Promise<ImageContent> {
    const { bytes, mimeType } = await this.store.readFile(filePath);
    return this.storeImage(bytes, mimeType);
  }

  /** 把已有附件的字节复制登记为一份新附件。 */
  async copyAttachment(attachmentId: string): Promise<ImageContent> {
    const row = this.attachmentRepo.findById(attachmentId);
    if (!row) {
      throw new Error(`附件不存在: ${attachmentId}`);
    }
    const bytes = await this.store.read(row.path);
    return this.storeImage(bytes, row.mimeType);
  }

  /** 删除若干附件：先删记录再删文件；记录不存在时跳过，文件删除失败只记日志。 */
  async deleteAttachments(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;

    const rows = this.attachmentRepo.findByIds(attachmentIds);
    this.attachmentRepo.deleteByIds(attachmentIds);
    this.store.remove(rows.map(row => row.path));
  }

  /** 按 id 查附件记录。 */
  getAttachment(attachmentId: string): AttachmentEntity | undefined {
    return this.attachmentRepo.findById(attachmentId);
  }

  /** 按 id 读出图片的 base64 与 MIME；附件不存在时返回 undefined。 */
  readImageBase64(attachmentId: string): { data: string; mimeType: string } | undefined {
    const row = this.attachmentRepo.findById(attachmentId);
    if (!row) return undefined;
    return { data: this.store.readBase64(row.path), mimeType: row.mimeType };
  }

  /**
   * 原样登记一张图片：不缩放、不转码，只校验格式与体积。
   *
   * 用于需要保留原始画质的素材。
   */
  async storeImageOriginal(bytes: Uint8Array, mimeType: string): Promise<ImageContent> {
    return this.storeImage(bytes, mimeType, { compress: false });
  }

  /**
   * 处理并落盘一张图片，登记附件行，返回图片引用。
   *
   * @throws 格式不支持或体积超限；写行失败时删掉已落盘的文件
   */
  private async storeImage(
    originalBytes: Uint8Array,
    declaredMimeType: string,
    options: { compress?: boolean } = {}
  ): Promise<ImageContent> {
    const buffer = Buffer.from(originalBytes);
    const mimeType = validateImageInput(buffer, declaredMimeType);

    // 传 compress: false 时保留原始字节：需要原图的场景不该被聊天侧的尺寸上限影响
    const prepared =
      options.compress === false
        ? { bytes: buffer, mimeType }
        : await this.store.compress(buffer, mimeType);
    const extension = imageExtensionFromMimeType(prepared.mimeType) ?? 'png';

    const attachmentId = randomUUID();
    const relativePath = this.store.writeImage(
      IMAGE_SUBDIR,
      `${attachmentId}.${extension}`,
      prepared.bytes
    );

    try {
      this.attachmentRepo.insert({
        id: attachmentId,
        path: relativePath,
        type: 'image',
        mimeType: prepared.mimeType,
        size: prepared.bytes.length,
      });
    } catch (error) {
      this.store.remove([relativePath]);
      throw error;
    }

    return { type: 'image', attachmentId };
  }
}
