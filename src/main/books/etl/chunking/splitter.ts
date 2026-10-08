import type { AnchorPoint, ChunkOptions, ChunkRange, TextUnit } from './types';

/** 切分默认参数：目标 600、自然边界下限 300、硬上限 800、重叠 120。 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetLength: 600,
  minLength: 300,
  maxLength: 800,
  overlapLength: 120,
};

/** 可作为分片自然结束位置的标点与换行。 */
const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '\n']);

/**
 * 按目标长度、最大长度和重叠长度生成连续的分片区间。
 *
 * 只读取单元的 value，锚点不参与计算——切分规则与文档格式无关。
 * @param units 单元数组，按阅读顺序排列
 * @param options 长度与重叠参数
 */
export function splitTextUnits(units: readonly TextUnit[], options: ChunkOptions): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  let startIndex = 0;

  while (startIndex < units.length) {
    const endIndex = findChunkEndIndex(units, startIndex, options);
    if (endIndex <= startIndex) break;

    ranges.push({ startIndex, endIndex });
    if (endIndex === units.length) break;
    // 以字符单元回退形成重叠；至少前进一个单元，避免极端文本导致死循环。
    startIndex = Math.max(startIndex + 1, endIndex - options.overlapLength);
  }

  return ranges;
}

/** 取区间内的正文并清理多余空白，保证内容适合检索与 AI 上下文。 */
export function buildChunkContent(units: readonly TextUnit[], range: ChunkRange): string {
  const content = units
    .slice(range.startIndex, range.endIndex)
    .map(unit => unit.value)
    .join('');
  return normalizeChunkContent(content);
}

/**
 * 取区间首尾锚点。
 * 为保留段落语义插入的换行没有锚点，会被跳过。
 * @returns 找不到有效锚点时该端为 null，由调用方降级到单元级定位
 */
export function findRangeAnchors(
  units: readonly TextUnit[],
  range: ChunkRange
): { start: AnchorPoint | null; end: AnchorPoint | null } {
  const chunkUnits = units.slice(range.startIndex, range.endIndex);
  return {
    start: chunkUnits.find(unit => unit.start)?.start ?? null,
    end: findLastEndAnchor(chunkUnits),
  };
}

/** 从后向前获取区间内最后一个可定位的结束锚点。 */
function findLastEndAnchor(units: readonly TextUnit[]): AnchorPoint | null {
  for (let index = units.length - 1; index >= 0; index--) {
    if (units[index].end) return units[index].end;
  }
  return null;
}

/** 优先在目标长度附近的句末或段落边界结束当前分片。 */
function findChunkEndIndex(
  units: readonly TextUnit[],
  startIndex: number,
  options: ChunkOptions
): number {
  const remainingLength = units.length - startIndex;
  if (remainingLength <= options.maxLength) return units.length;

  const targetIndex = startIndex + options.targetLength;
  const maximumIndex = startIndex + options.maxLength;

  // 优先向后扩展到自然边界，使大多数分片靠近目标长度但不超过最大长度。
  for (let index = targetIndex; index < maximumIndex; index++) {
    if (isSentenceEnding(units[index])) return index + 1;
  }
  // 向后找不到边界时再向前回退，避免中间分片因段落过短而低于最小长度。
  for (let index = targetIndex - 1; index >= startIndex + options.minLength - 1; index--) {
    if (isSentenceEnding(units[index])) return index + 1;
  }
  return maximumIndex;
}

/** 判断一个文本单元是否可作为分片的自然结束位置。 */
function isSentenceEnding(unit: TextUnit): boolean {
  return SENTENCE_ENDINGS.has(unit.value);
}

/** 清理分片内多余空白，保留段落边界。 */
function normalizeChunkContent(content: string): string {
  return content
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
