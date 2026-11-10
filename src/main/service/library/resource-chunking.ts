import {
  DEFAULT_CHUNK_OPTIONS,
  chunkDocument,
  type ChunkOptions,
  type DocumentSource,
} from '@main/service/etl/chunking';
import type { ResourceChunkDraft } from '@main/contracts/resource-ocr';

/**
 * 把任意格式的文档源切成分片。
 *
 * 格式差异由调用方选择的 `DocumentSource` 决定；这里只负责跑切分和映射落库形状。
 *
 * @param source 文档源，决定有哪些单元、文字在哪、位置怎么写下来
 * @param options 长度与重叠参数
 * @returns 可直接写入 `resource_chunk` 的分片
 */
export async function chunkResource(
  source: DocumentSource,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): Promise<ResourceChunkDraft[]> {
  const drafts = await chunkDocument(source, options);
  return drafts.map(draft => ({
    text: draft.content,
    locator: draft.locatorStart,
    meta: JSON.stringify({
      segmentIndex: draft.segmentIndex,
      segmentId: draft.segmentId,
      chunkIndex: draft.chunkIndex,
      locatorEnd: draft.locatorEnd,
    }),
  }));
}
