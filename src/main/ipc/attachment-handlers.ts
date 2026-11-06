import { IpcChannel } from '@shared/ipc-channels';
import type { AttachmentStoreRequest } from '@shared/types/chat';
import type { AttachmentService } from '@main/service/attachment-service';
import { pickImages } from './dialogs';
import { registerDirectHandler } from './register-handler';

/**
 * 注册附件通道。
 *
 * 返回体直接是图片引用数组，渲染层按原样使用，因此不套成功信封。
 *
 * @param attachment 装配根持有的附件服务
 */
export function registerAttachmentHandlers(attachment: AttachmentService): void {
  registerDirectHandler(IpcChannel.Attachment_Store, async (request: AttachmentStoreRequest) => {
    const images = request.images?.length ? request.images : await pickImages();
    if (!images) return [];
    return attachment.storeImages(images);
  });
}
