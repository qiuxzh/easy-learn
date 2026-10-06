import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { Constants } from '@main/constants';
import { defineSessionTool, SessionTool } from '../agent-definition';

/**
 * 本工具只返回图片引用（路径 + MIME），不返回 base64：
 * 图片数据在发往模型前由 hydrate-images 按需读盘填入，会话日志里只留路径。
 * 结果同样不提供 details：界面只读 content，没有消费方。
 */

const readImageSchema = Type.Object({
  path: Type.String({ description: 'Path to the image file (relative to the data directory)' }),
});

/** 扩展名 → MIME 类型，与 read 让渡给 read_image 的扩展名保持一致 */
const mimeTypeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
]);

/**
 * 把传入路径解析成绝对路径，并校验它落在工作目录内：
 * 工作目录既是相对路径的基准，也是可读范围的边界。
 * 返回的引用路径始终相对 data 目录，因为 hydrate-images 读盘时按 data 目录解析。
 */
function resolveImagePath(
  input: string,
  cwd: string
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.resolve(cwd, input);
  const relative = path.relative(cwd, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const scope = cwd === Constants.dataDir ? 'data 目录' : cwd;
    throw new Error(`路径超出可读范围（可读范围：${scope}）：${input}`);
  }

  // 引用路径越出 data 目录时 hydrate-images 解析不了，图片到不了模型：当场报错，好过静默变成占位文本
  const referencePath = path.relative(Constants.dataDir, absolutePath);
  if (!referencePath || referencePath.startsWith('..') || path.isAbsolute(referencePath)) {
    throw new Error(`图片必须位于 data 目录内才能随请求发给模型：${absolutePath}`);
  }

  return {
    absolutePath,
    relativePath: referencePath.split(path.sep).join('/'),
  };
}

/** 读取图片：把图片作为图片内容交给模型查看。 */
export function createReadImageTool(
  cwd: string = Constants.dataDir // 基础目录，不传时以 data 目录为范围
): SessionTool<typeof readImageSchema, undefined> {
  return defineSessionTool({
    name: 'read_image',
    description:
      '读取应用数据目录（data）下的图片，把图片本身交给模型查看。只能读图片，不能读文本文件。',
    promptSnippet: '查看图片内容',
    promptGuidelines: [
      '需要查看图片内容时用 read_image；read 只读文本文件，遇到图片会报错。',
      'read_image 只能读 data 目录下的图片，路径相对 data 目录填写。',
    ],
    parameters: readImageSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const { absolutePath, relativePath } = resolveImagePath(params.path, cwd);
      const mimeType = mimeTypeByExtension.get(path.extname(absolutePath).toLowerCase());
      if (!mimeType) {
        throw new Error(
          `${params.path} 不是支持的图片格式（支持 ${[...mimeTypeByExtension.keys()].join('、')}）`
        );
      }

      await fsAccess(absolutePath, constants.R_OK);

      return {
        content: [
          { type: 'text' as const, text: `读取图片：${relativePath}（${mimeType}）` },
          { type: 'image' as const, path: relativePath, mimeType },
        ],
        details: undefined,
      };
    },
  });
}
