import type {
  AgentMessage,
  ImageContent,
  Message,
  SessionEntry,
  TextContent,
  Usage,
} from '@shared/types/chat';
import type { StreamFn } from '@main/agent/model/stream-fn';
import type { Model } from '@main/agent/model/types';
import {
  getLatestCompaction,
  sessionEntryToContextMessages,
} from '@main/agent/common-agent/session-manager';

/**
 * 上下文压缩：把最老的一段对话交给 LLM 压成一份结构化摘要，用一条 compaction entry 顶替它们，
 * 只保留最近的一段原始消息。原文不删，只是不再进入上下文。
 *
 * 术语：
 * - 摘要窗口：被摘要顶替的那段 entry，起点是上一次压缩的保留区起点（没有则是日志开头）。
 * - 保留区：压缩后仍原样进入上下文的那段 entry，起点即 firstKeptEntryId。
 */

/** 一张图折算的字符数。图片数据不进上下文，发往模型前才按路径读成 base64。 */
const ESTIMATED_IMAGE_CHARS = 4800;
/** 粗估用：1 token ≈ 4 字符。中文会低估约 4 倍，但只在没有真实 usage 可锚定时才用到。 */
const CHARS_PER_TOKEN = 4;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? ...]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** 续写摘要时的补充指令：新摘要要覆盖旧摘要里仍然有效的信息。 */
const PREVIOUS_SUMMARY_HINT =
  'An earlier summary covering even older messages is appended below. Fold anything still relevant into your new summary; the earlier summary will be discarded.';

/** 压缩设置。最小实现直接硬编码，不引入配置层。 */
export interface CompactionSettings {
  enabled: boolean;
  /** 预留给模型输出的额度：上下文用量超过 contextWindow - reserveTokens 就压缩。 */
  reserveTokens: number;
  /** 压缩后保留的最近 token 数，必须明显小于 contextWindow - reserveTokens。 */
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

/** 一次压缩的结果，随 compaction_end 事件发给界面，并写入 CompactionEntry。 */
export interface CompactionResult {
  summary: string;
  /** 保留区第一条 entry 的 id。 */
  firstKeptEntryId: string;
  /** 压缩前的上下文 token 估算。 */
  tokensBefore: number;
  /** 压缩后的上下文 token 估算（摘要 + 保留区）。 */
  estimatedTokensAfter: number;
  /** 生成摘要那次 LLM 调用的用量。 */
  usage?: Usage;
}

/** prepareCompaction 的产物：交给摘要的消息窗口，以及保留区起点。 */
export interface CompactionPreparation {
  firstKeptEntryId: string;
  /** 需要被摘要顶替的消息。 */
  messagesToSummarize: AgentMessage[];
  /** 上一次压缩的摘要，用于在其基础上续写，避免每轮压缩丢掉更早的信息。 */
  previousSummary?: string;
}

/** 上下文 token 估算结果。 */
export interface ContextUsageEstimate {
  /** 上下文总 token 估算。 */
  tokens: number;
  /** 由最后一条助手消息的真实 usage 锚定的部分。 */
  usageTokens: number;
  /** 锚点之后追加消息的估算部分。 */
  trailingTokens: number;
  /** 锚点所在消息下标；没有可用的 usage 时为 null。 */
  lastUsageIndex: number | null;
}

/** 摘要请求的输入。 */
export interface CompactInput {
  streamFn: StreamFn;
  model: Model<any>;
  /** 待摘要的消息。 */
  messages: AgentMessage[];
  /** 上一次压缩的摘要（若有）。 */
  previousSummary?: string;
  signal?: AbortSignal;
}

/** 摘要请求的产物。 */
export interface CompactionSummary {
  summary: string;
  usage?: Usage;
}

/**
 * 切点：保留区从哪条 entry 开始。
 * 之所以要"切点"而不是随便切：保留区必须以 user 消息开头，
 * 否则模型会看到一条没有对应提问的助手回复。
 */
export interface CutPointResult {
  /** 保留区第一条 entry 的下标。 */
  firstKeptEntryIndex: number;
}

/** 估算一组消息占用的 token 数。 */
export function estimateTokens(message: AgentMessage): number {
  return Math.ceil(countMessageChars(message) / CHARS_PER_TOKEN);
}

/**
 * 一块内容里的字符数。图片按固定字符数折算，工具调用按参数 JSON 的字符数算。
 */
function countMessageChars(message: AgentMessage): number {
  if (message.role === 'assistant') {
    return message.content.reduce((sum, block) => {
      if (block.type === 'text') return sum + block.text.length;
      if (block.type === 'thinking') return sum + block.thinking.length;
      return sum + JSON.stringify(block.arguments).length;
    }, 0);
  }
  return countContentChars(message.content);
}

function countContentChars(content: string | (TextContent | ImageContent)[]): number {
  if (typeof content === 'string') return content.length;

  let chars = 0;
  for (const block of content) {
    if (block.type === 'text') {
      chars += block.text.length;
    } else if (block.type === 'image') {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/**
 * 取一条消息的用量；只有正常结束的助手消息才算数。
 * 中止/失败的请求会带上不完整的 usage，用它当锚点会低估上下文。
 */
function getAssistantUsage(message: AgentMessage): Usage | undefined {
  if (message.role !== 'assistant') return undefined;

  if (
    message.stopReason !== 'aborted' &&
    message.stopReason !== 'error' &&
    message.usage &&
    calculateContextTokens(message.usage) > 0
  ) {
    return message.usage;
  }
  return undefined;
}

/** 找最近一条带可用 usage 的助手消息。 */
function getLastAssistantUsageInfo(
  messages: AgentMessage[]
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + (usage.cacheRead ?? 0);
}

/**
 * 估算上下文 token 数。
 * 有助手 usage 时以它为锚点（usage 已经包含整个请求的上下文），只外加锚点之后追加的消息；
 * 一条 usage 都没有（例如首轮就失败）才逐条粗估。
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** 判断当前上下文是否已接近窗口上限，需要压缩。 */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

/** entry 是否开启了一个 turn：产出消息且第一条是 user。 */
function isTurnStartEntry(entry: SessionEntry): boolean {
  const messages = sessionEntryToContextMessages(entry);
  return messages.length > 0 && messages[0].role === 'user';
}

/**
 * 可切成保留区起点的 entry 下标。
 * toolResult 不能当起点：它的 toolCall 会被留在摘要窗口里，模型会看到凭空的工具结果。
 */
function findValidCutPoints(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number
): number[] {
  const points: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const messages = sessionEntryToContextMessages(entries[i]);
    if (messages.length === 0) continue;
    if (messages.every(message => message.role !== 'toolResult')) {
      points.push(i);
    }
  }
  return points;
}

/** 从 cutIndex 往回找最近的一个 turn 起点；找不到就原地不动。 */
function snapToTurnStart(entries: SessionEntry[], cutIndex: number, startIndex: number): number {
  for (let i = cutIndex; i >= startIndex; i--) {
    if (isTurnStartEntry(entries[i])) return i;
  }
  return cutIndex;
}

/**
 * 从最新往回累计 token，找到刚好能留下 keepRecentTokens 的切点。
 * 切点必须落在合法位置，且回退到 turn 起点，保证保留区是完整的 turn。
 */
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number
): CutPointResult {
  // 排除toolResult
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex };
  }

  // 默认保留全部（退化为"只把第一段切给摘要"）
  let cutIndex = cutPoints[0];
  let accumulatedTokens = 0;

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entryTokens = sessionEntryToContextMessages(entries[i]).reduce(
      (sum, message) => sum + estimateTokens(message),
      0
    );
    // 不产消息的变更类 entry 不计入，也不做切点
    if (entryTokens === 0) continue;

    accumulatedTokens += entryTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      // 最近的、不早于当前下标的合法切点
      cutIndex = cutPoints.find(point => point >= i) ?? cutIndex;
      break;
    }
  }

  return { firstKeptEntryIndex: snapToTurnStart(entries, cutIndex, startIndex) };
}

/**
 * 决定这次压缩要摘要哪些消息、保留区从哪条 entry 开始。
 * 返回 undefined 表示当前没有可压缩的内容（日志为空、末尾已是压缩标记、或窗口内没有可摘要的消息）。
 */
export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings
): CompactionPreparation | undefined {
  if (pathEntries.length === 0) return undefined;
  // 幂等：末尾已经是压缩标记，说明没有新消息需要压缩
  if (pathEntries[pathEntries.length - 1].type === 'compaction') return undefined;

  // 上一次压缩决定了摘要窗口的左边界：它已经顶替掉的部分不必再摘要
  const prevCompaction = getLatestCompaction(pathEntries);
  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompaction) {
    previousSummary = prevCompaction.summary;
    const firstKeptIndex = pathEntries.findIndex(
      entry => entry.id === prevCompaction.firstKeptEntryId
    );
    // 找不到起点说明日志不完整，宁可不动
    boundaryStart = firstKeptIndex >= 0 ? firstKeptIndex : pathEntries.length;
  }

  const cutPoint = findCutPoint(
    pathEntries,
    boundaryStart,
    pathEntries.length,
    settings.keepRecentTokens
  );
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry) return undefined;

  const messagesToSummarize = pathEntries
    .slice(boundaryStart, cutPoint.firstKeptEntryIndex)
    .flatMap(sessionEntryToContextMessages);
  if (messagesToSummarize.length === 0) return undefined;

  return { firstKeptEntryId: firstKeptEntry.id, messagesToSummarize, previousSummary };
}

/**
 * 发一次独立的 LLM 请求把待摘要消息压成结构化摘要。
 *
 * 请求不带工具、不带系统提示：历史消息 + 一条要求按固定格式输出的用户消息。
 * 图片降级为占位文本——摘要不需要图片内容，也避免依赖发往模型前才注入的 base64 数据。
 */
export async function compact(input: CompactInput): Promise<CompactionSummary> {
  const { streamFn, model, messages, previousSummary, signal } = input;
  const prompt = previousSummary
    ? `${SUMMARIZATION_PROMPT}\n\n${PREVIOUS_SUMMARY_HINT}\n\n${previousSummary}`
    : SUMMARIZATION_PROMPT;

  const stream = await streamFn(
    model,
    {
      messages: [
        ...stripImages(messages),
        { role: 'user', content: prompt, timestamp: Date.now() },
      ],
    },
    { signal }
  );
  const message = await stream.result();

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(message.errorMessage ?? `摘要请求失败：${message.stopReason}`);
  }

  const summary = message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
  if (!summary) {
    throw new Error('摘要请求返回了空内容');
  }

  return { summary, usage: message.usage };
}

/** 把消息里的图片块换成占位文本。 */
function stripImages(messages: AgentMessage[]): Message[] {
  return messages.map(message => {
    if (message.role === 'assistant' || typeof message.content === 'string') {
      return message;
    }
    return {
      ...message,
      content: message.content.map(block =>
        block.type === 'image' ? { type: 'text' as const, text: '[图片]' } : block
      ),
    };
  });
}
