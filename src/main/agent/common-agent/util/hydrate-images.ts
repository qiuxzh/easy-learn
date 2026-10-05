import fs from 'node:fs';
import path from 'node:path';
import { Constants } from '@main/constants';
import type { AgentMessage, ImageContent, Message, TextContent } from '@shared/types/chat';

/** 当前模型不支持图片时，顶替图片块的文本 */
const UNSUPPORTED_PLACEHOLDER = '(image omitted: current model does not support images)';

/** 图片读取失败时，顶替图片块的文本 */
const UNREADABLE_PLACEHOLDER = '(image omitted: could not be read from disk)';

/**
 * 按相对 dataDir 的路径读盘并转成 base64。
 * 路径先解析再校验确实落在图片目录内，避免日志里的路径越权读到别处。
 */
async function readImageBase64(imagePath: string): Promise<string> {
  const target = path.resolve(Constants.dataDir, imagePath);
  const relative = path.relative(Constants.imageDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`非法的图片路径: ${imagePath}`);
  }

  const bytes = await fs.promises.readFile(target);
  return bytes.toString('base64');
}

/** 消息内容是否为可能含图片的块数组 */
function hasImageContent(message: Message): boolean {
  if (message.role !== 'user' && message.role !== 'toolResult') return false;
  return Array.isArray(message.content) && message.content.some(block => block.type === 'image');
}

/**
 * 读取图片的 base64；同一路径在一次转换里只读一次。
 * 读取失败不抛异常，返回 undefined 交给调用方降级。
 */
function readImageData(
  imagePath: string,
  pending: Map<string, Promise<string | undefined>>
): Promise<string | undefined> {
  const cached = pending.get(imagePath);
  if (cached) return cached;

  const task = readImageBase64(imagePath).catch(() => undefined);
  pending.set(imagePath, task);
  return task;
}

/**
 * 把内容块里的图片引用读成 base64。
 * 没有图片时原样返回入参数组，避免无谓拷贝。
 */
async function hydrateContent(
  content: (TextContent | ImageContent)[],
  supportsImage: boolean,
  pending: Map<string, Promise<string | undefined>>
): Promise<(TextContent | ImageContent)[]> {
  if (!content.some(block => block.type === 'image')) return content;

  const result: (TextContent | ImageContent)[] = [];
  // 相邻图片合并为一个占位，避免连出多行同样的提示
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type !== 'image') {
      result.push(block);
      previousWasPlaceholder = false;
      continue;
    }

    // 模型看不了图片：不读盘，直接降级
    if (!supportsImage) {
      if (!previousWasPlaceholder) result.push({ type: 'text', text: UNSUPPORTED_PLACEHOLDER });
      previousWasPlaceholder = true;
      continue;
    }

    const data = await readImageData(block.path, pending);
    if (data === undefined) {
      console.warn(`[imageHydrator] 图片读取失败，已降级为占位文本: ${block.path}`);
      if (!previousWasPlaceholder) result.push({ type: 'text', text: UNREADABLE_PLACEHOLDER });
      previousWasPlaceholder = true;
      continue;
    }

    result.push({ ...block, data });
    previousWasPlaceholder = false;
  }

  return result;
}

/**
 * 产出 convertToLlm：把上下文里的图片引用（只带 path）在发往模型前读成 base64。
 *
 * 两条硬约束：
 * - 不改动入参对象。内核的 state.messages 与落库共用同一批对象，就地写入 data 会把 base64 存进会话日志；
 * - 拿不到图片时降级为占位文本，不让整轮请求失败。
 */
export function createImageHydrator(options: {
  /** 当前模型是否支持图片，取自 Model.input */
  supportsImage: boolean;
}): (messages: AgentMessage[]) => Promise<Message[]> {
  return async messages => {
    // 上下文里没有图片时整段透传，绝大多数轮次走这条路
    if (!messages.some(message => hasImageContent(message))) {
      return messages;
    }

    const pending = new Map<string, Promise<string | undefined>>();
    const result: Message[] = [];

    // 图片只可能出现在用户消息与工具结果里
    for (const message of messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const content = await hydrateContent(message.content, options.supportsImage, pending);
        result.push(content === message.content ? message : { ...message, content });
        continue;
      }
      if (message.role === 'toolResult') {
        const content = await hydrateContent(message.content, options.supportsImage, pending);
        result.push(content === message.content ? message : { ...message, content });
        continue;
      }
      result.push(message);
    }

    return result;
  };
}
