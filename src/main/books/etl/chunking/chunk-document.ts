import {
  DEFAULT_CHUNK_OPTIONS,
  buildChunkContent,
  findRangeAnchors,
  splitTextUnits,
} from './splitter';
import type { ChunkDraft, ChunkOptions, DocumentSource, SegmentInfo } from './types';

/**
 * 通用切分编排：一个文档源进，一批格式无关的 ChunkDraft 出。
 *
 * 不认识 bookId、不认识数据库、不认识任何具体格式，因此可脱离 Electron 与 SQLite 测试。
 * 逐个单元独立切分，跨单元的分片无法表达——这条不变量由 ChunkDraft 的类型固化。
 * @param source 文档源，决定有哪些单元、文字在哪、位置怎么写下来
 * @param options 长度与重叠参数
 */
export async function chunkDocument<TSegment extends SegmentInfo>(
  source: DocumentSource<TSegment>,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): Promise<ChunkDraft[]> {
  const drafts: ChunkDraft[] = [];

  for (const segment of await source.listSegments()) {
    const units = await source.loadTextUnits(segment);

    for (const [chunkIndex, range] of splitTextUnits(units, options).entries()) {
      const content = buildChunkContent(units, range);
      if (!content) continue;

      // 锚点指向本次加载出来的文档，离开本次循环即失效，必须在这里完成编码。
      const anchors = findRangeAnchors(units, range);
      const startLocator = anchors.start ? source.encodeLocator(segment, anchors.start) : null;
      const endLocator = anchors.end ? source.encodeLocator(segment, anchors.end) : null;

      drafts.push({
        segmentIndex: segment.index,
        segmentId: segment.id,
        chunkIndex,
        content,
        // 编码不出时降级到单元级定位，避免整本书一个可检索分片都没有。
        locatorStart: startLocator ?? segment.fallbackLocator,
        locatorEnd: endLocator ?? segment.fallbackLocator,
      });
    }
  }

  return drafts;
}
