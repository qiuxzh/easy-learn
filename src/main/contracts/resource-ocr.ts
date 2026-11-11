import type { BookPageBlock } from '@shared/types/ocr';
import type { OcrStartResult, ResourceOcrStateDTO } from '@shared/types/ocr';

// `ResourceDocMeta`（doc_meta 的 JSON 形状）已迁到 @shared/types/library；
// 这里只保留 OCR 自身的类型。

/** 一页的 OCR 结果。 */
export interface ResourceOcrPage {
  /** 页号，从 1 开始。 */
  page: number;
  blocks: BookPageBlock[];
}

/** 写入 `resource_chunk` 前的分片。 */
export interface ResourceChunkDraft {
  text: string;
  locator: string | null;
  /** 格式相关的补充信息 JSON。 */
  meta: string | null;
}

/** 服务层沿用领域名；形状与 IPC DTO 一致。 */
export type ResourceOcrState = ResourceOcrStateDTO;

/** 启动识别后的返回值。 */
export type ResourceOcrStartResult = OcrStartResult;
