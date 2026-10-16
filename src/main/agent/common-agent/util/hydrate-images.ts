import fs from 'node:fs';
import path from 'node:path';
import { Constants } from '@main/constants';
import { attachmentRepo } from '@main/db/repo';
import type { AgentMessage, ImageContent, Message, TextContent } from '@shared/types/chat';

/** 模型不支持图片时顶替图片块的文本 */
const UNSUPPORTED_PLACEHOLDER = '(image omitted: current model does not support images)';

/** 附件读取失败时顶替图片块的文本 */
const MISSING_PLACEHOLDER = '(image omitted: attachment no longer exists)';

/** 按附件 id 读盘并转成 base64，路径必须落在附件目录内 */
function readAttachment(attachmentId: string): { data: string; mimeType: string } | undefined {
  const row = attachmentRepo.findById(attachmentId);
  if (!row) return undefined;

  const target = path.resolve(Constants.dataDir, row.path);
  const relative = path.relative(Constants.attachmentDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`非法的附件路径: ${row.path}`);
  }

  const bytes = fs.readFileSync(target);
  return { data: bytes.toString('base64'), mimeType: row.mimeType };
}

/** 消息内容是否含图片块 */
function hasImageContent(message: Message): boolean {
  if (message.role !== 'user' && message.role !== 'toolResult') return false;
  return Array.isArray(message.content) && message.content.some(block => block.type === 'image');
}

/** 把内容块里的图片引用读成带 base64 的块，没有图片时原样返回入参数组 */
function hydrateContent(
  content: (TextContent | ImageContent)[],
  supportsImage: boolean
): (TextContent | ImageContent)[] {
  if (!content.some(block => block.type === 'image')) return content;

  const result: (TextContent | ImageContent)[] = [];
  // 相邻的占位文本只保留一个
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type !== 'image') {
      result.push(block);
      previousWasPlaceholder = false;
      continue;
    }

    if (!supportsImage) {
      if (!previousWasPlaceholder) result.push({ type: 'text', text: UNSUPPORTED_PLACEHOLDER });
      previousWasPlaceholder = true;
      continue;
    }

    let attachment: { data: string; mimeType: string } | undefined;
    try {
      attachment = readAttachment(block.attachmentId);
    } catch (error) {
      console.error('[imageHydrator] 附件读取异常:', block.attachmentId, error);
    }

    if (!attachment) {
      console.warn(`[imageHydrator] 附件读取失败，已降级为占位文本: ${block.attachmentId}`);
      if (!previousWasPlaceholder) result.push({ type: 'text', text: MISSING_PLACEHOLDER });
      previousWasPlaceholder = true;
      continue;
    }

    result.push({ ...block, mimeType: attachment.mimeType, data: attachment.data });
    previousWasPlaceholder = false;
  }

  return result;
}

/**
 * 产出 convertToLlm：发请求前把图片引用读成 base64，不改动入参对象，读取失败降级为占位文本。
 */
export function createImageHydrator(options: {
  /** 当前模型是否支持图片 */
  supportsImage: boolean;
}): (messages: AgentMessage[]) => Promise<Message[]> {
  return async messages => {
    if (!messages.some(message => hasImageContent(message))) {
      return messages;
    }

    const result: Message[] = [];
    for (const message of messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const content = hydrateContent(message.content, options.supportsImage);
        result.push(content === message.content ? message : { ...message, content });
        continue;
      }
      if (message.role === 'toolResult') {
        const content = hydrateContent(message.content, options.supportsImage);
        result.push(content === message.content ? message : { ...message, content });
        continue;
      }
      result.push(message);
    }

    return result;
  };
}
