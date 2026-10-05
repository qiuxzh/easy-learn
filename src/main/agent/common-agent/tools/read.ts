import { constants } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { Constants } from '@main/constants';
import { defineSessionTool, SessionTool } from '../agent-definition';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type TruncationResult,
  truncateHeadTail,
} from '../util/truncate';

/**
 * read 的结果只有正文或提示，不提供 details：界面只读 content，没有消费方。
 * 将来界面确实要渲染结构化数据（如文件大小、截断统计）时，再加 details。
 */

const readSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(
    Type.Number({ minimum: 1, description: 'Line number to start reading from (1-indexed)' })
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, description: 'Maximum number of lines to read' })),
});

export interface ReadOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Check if file is readable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
}

const defaultReadOperations: ReadOperations = {
  readFile: path => fsReadFile(path),
  access: path => fsAccess(path, constants.R_OK),
};

/** read 只读文本：这些扩展名一律引导到 read_image */
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

/**
 * 把传入路径解析成绝对路径，并校验它落在工作目录内：
 * 工作目录既是相对路径的基准，也是可读范围的边界。
 * 用 .. 绕出工作目录、或指向工作目录本身的路径都会被拒绝。
 */
function resolveReadPath(input: string, cwd: string): string {
  const absolutePath = path.resolve(cwd, input);
  const relative = path.relative(cwd, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const scope = cwd === Constants.dataDir ? 'data 目录' : cwd;
    throw new Error(`路径超出可读范围（可读范围：${scope}）：${input}`);
  }
  return absolutePath;
}

/**
 * 截断后的正文：头部 + 省略标记 + 尾部，末尾附一段说明（含续读用的 offset）。
 * 行号都是窗口内的显示行号（1 起）。
 */
function formatTruncatedBody(
  truncation: TruncationResult,
  firstLineDisplay: number,
  lastLineDisplay: number,
  fileLines: number
): string {
  const headRange =
    truncation.headLines > 0
      ? `头部第 ${firstLineDisplay}-${firstLineDisplay + truncation.headLines - 1} 行`
      : truncation.firstLineExceedsLimit
        ? '首行单行过长，头部未保留'
        : '头部未保留';
  const tailRange =
    truncation.tailLines > 0
      ? `尾部第 ${lastLineDisplay - truncation.tailLines + 1}-${lastLineDisplay} 行`
      : '尾部未保留';
  const continueHint =
    truncation.headLines > 0
      ? `；可用 offset=${firstLineDisplay + truncation.headLines} 继续读取中间部分`
      : '';
  return [
    truncation.head,
    truncation.omittedLines > 0 ? `[... 省略 ${truncation.omittedLines} 行 ...]` : '',
    truncation.tail,
    `[已显示${headRange}与${tailRange}（共 ${fileLines} 行），单次输出上限 ${DEFAULT_MAX_LINES} 行 / ${DEFAULT_MAX_BYTES / 1024}KB${continueHint}]`,
  ]
    .filter(part => part.length > 0)
    .join('\n');
}

/** 读取文本文件：支持 offset/limit 指定行范围，超长时保留头尾并给出续读用的 offset。 */
export function createReadTool(
  cwd: string = Constants.dataDir // 基础目录，不传时以 data 目录为范围
): SessionTool<typeof readSchema, undefined> {
  return defineSessionTool({
    name: 'read',
    label: '读取文件',
    description:
      `读取应用数据目录（data）下的文本文件内容。offset 指定起始行号（从 1 开始），limit 指定最多读取多少行；` +
      `单次输出最多 ${DEFAULT_MAX_LINES} 行或 ${DEFAULT_MAX_BYTES / 1024}KB，超出时保留头部与尾部、省略中间，并给出继续读取的 offset。`,
    promptSnippet: '读取非二进制的文本文件',
    promptGuidelines: [
      'read 适合读取非二进制的文本文件（配置、导出的文本等）。',
      '需要查看图片时用 read_image，不要用 read。',
    ],
    parameters: readSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const absolutePath = resolveReadPath(params.path, cwd);
      if (imageExtensions.has(path.extname(absolutePath).toLowerCase())) {
        throw new Error(`${params.path} 是图片文件，read 不读图片，请改用 read_image`);
      }

      await defaultReadOperations.access(absolutePath);
      const buffer = await defaultReadOperations.readFile(absolutePath);

      if (buffer.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '(空文件)' }],
          details: undefined,
        };
      }

      const lines = buffer.toString('utf-8').split('\n');
      // 结尾的换行不算作多出一行，与 truncate 的行数统计保持一致
      if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      // 入参行号从 1 开始，数组下标从 0 开始
      const startLine = (params.offset ?? 1) - 1;
      if (startLine >= lines.length) {
        throw new Error(`offset ${params.offset} 超出文件总行数（共 ${lines.length} 行）`);
      }
      const endLine =
        params.limit === undefined
          ? lines.length
          : Math.min(startLine + params.limit, lines.length);

      const windowLines = lines.slice(startLine, endLine);
      const truncation = truncateHeadTail(windowLines.join('\n'));
      const firstLineDisplay = startLine + 1;
      const lastLineDisplay = startLine + windowLines.length;

      let body: string;
      if (truncation.truncated) {
        body = formatTruncatedBody(truncation, firstLineDisplay, lastLineDisplay, lines.length);
      } else if (endLine < lines.length) {
        body = `${truncation.head}\n\n[文件共 ${lines.length} 行，还有 ${lines.length - endLine} 行未读，用 offset=${endLine + 1} 继续读取]`;
      } else {
        body = truncation.head;
      }

      return {
        content: [{ type: 'text' as const, text: body }],
        details: undefined,
      };
    },
  });
}
