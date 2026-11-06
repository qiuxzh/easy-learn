import path from 'node:path';
import { Type } from 'typebox';
import { IMAGE_EXTENSIONS, isSupportedImageExtension } from '@shared/utils/file-util';
import type { AttachmentService } from '@main/service/attachment-service';
import { defineSessionTool, SessionTool } from '../agent-definition';

const readImageSchema = Type.Object({
  path: Type.String({ description: 'Path to the image file (relative to the data directory)' }),
});

/** 把传入路径解析成绝对路径，并校验它落在 data 目录内 */
function resolveImagePath(input: string, dataDir: string): string {
  const absolutePath = path.resolve(dataDir, input);
  const relative = path.relative(dataDir, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径超出可读范围（可读范围：data 目录）：${input}`);
  }
  return absolutePath;
}

/** 按路径读取 data 目录下的图片，登记为新附件后交给模型查看 */
export function createReadImageTool(options: {
  /** 数据根目录，图片寻址以它为界 */
  dataDir: string;
  /** 附件服务，用于登记图片 */
  attachment: AttachmentService;
}): SessionTool<typeof readImageSchema, undefined> {
  return defineSessionTool({
    name: 'read_image',
    description: '读取应用数据目录下的图片文件，把图片本身交给模型查看',
    promptSnippet: '按路径查看图片',
    parameters: readImageSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const absolutePath = resolveImagePath(params.path, options.dataDir);
      if (!isSupportedImageExtension(path.extname(absolutePath))) {
        throw new Error(
          `${params.path} 不是支持的图片格式（支持 ${IMAGE_EXTENSIONS.map(ext => '.' + ext).join('、')}）`
        );
      }

      const stored = await options.attachment.storeFromFile(absolutePath);
      return {
        content: [
          { type: 'text' as const, text: `读取图片：${params.path}` },
          { type: 'image' as const, attachmentId: stored.attachmentId },
        ],
        details: undefined,
      };
    },
  });
}
