import { Type } from 'typebox';
import type { AttachmentService } from '@main/service/attachment-service';
import { defineSessionTool, SessionTool } from '../agent-definition';

const readAttachmentImageSchema = Type.Object({
  attachmentId: Type.String({ description: '要查看的图片附件 id' }),
});

/** 按附件 id 读取图片，拷贝出一份新附件交给模型查看 */
export function createReadAttachmentImageTool(options: {
  /** 附件服务，用于拷贝图片 */
  attachment: AttachmentService;
}): SessionTool<typeof readAttachmentImageSchema, undefined> {
  return defineSessionTool({
    name: 'read_attachment_image',
    description:
      '按附件 id 读取之前出现过的图片，把图片本身交给模型查看。附件 id 见消息中标注的 attachmentId。',
    promptSnippet: '根据attachmentId查看图片内容',
    parameters: readAttachmentImageSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const stored = await options.attachment.copyAttachment(params.attachmentId);
      return {
        content: [
          { type: 'text' as const, text: `成功读取图片：${stored.attachmentId}` },
          { type: 'image' as const, attachmentId: stored.attachmentId },
        ],
        details: undefined,
      };
    },
  });
}
