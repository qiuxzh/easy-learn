import path from 'node:path';
import { Type } from 'typebox';
import { Constants } from '@main/constants';
import { attachmentService } from '@main/service/attachment-service';
import { defineSessionTool, SessionTool } from '../agent-definition';

const readImageSchema = Type.Object({
  path: Type.String({ description: 'Path to the image file (relative to the data directory)' }),
});

/** 支持的图片扩展名 */
const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

/** 把传入路径解析成绝对路径，并校验它落在 data 目录内 */
function resolveImagePath(input: string): string {
  const absolutePath = path.resolve(Constants.dataDir, input);
  const relative = path.relative(Constants.dataDir, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径超出可读范围（可读范围：data 目录）：${input}`);
  }
  return absolutePath;
}

/** 按路径读取 data 目录下的图片，登记为新附件后交给模型查看 */
export function createReadImageTool(): SessionTool<typeof readImageSchema, undefined> {
  return defineSessionTool({
    name: 'read_image',
    description: '读取应用数据目录下的图片文件，把图片本身交给模型查看',
    promptSnippet: '按路径查看图片',
    parameters: readImageSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const absolutePath = resolveImagePath(params.path);
      const extension = path.extname(absolutePath).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        throw new Error(
          `${params.path} 不是支持的图片格式（支持 ${[...supportedExtensions.keys()].join('、')}）`
        );
      }

      const stored = await attachmentService.storeFromFile(absolutePath);
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
