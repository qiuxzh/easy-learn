import type { ResourceChunkDraft, ResourceOcrPage } from './resource-ocr';

/** `resource_ocr_page` 的持久化接口。 */
export interface ResourceOcrPageRepo {
  /** 已落库的页号，用于跳过已识别的页。 */
  listPageNumbers(resourceId: string): number[];

  /** 全部页块，按页号升序；传 pages 时只取这些页。 */
  listPages(resourceId: string, pages?: readonly number[]): ResourceOcrPage[];

  /** 已落库的页数。 */
  countPages(resourceId: string): number;

  /** 删除指定页；不传时删除该资源的全部页。 */
  deletePages(resourceId: string, pages?: readonly number[]): void;

  /** 批量写入或覆盖页块。 */
  insertMany(resourceId: string, pages: readonly ResourceOcrPage[]): void;
}

/** `resource_chunk` 的持久化接口。 */
export interface ResourceChunkRepo {
  /** 已写入的分片数。 */
  count(resourceId: string): number;

  /** 删除该资源的全部分片。 */
  deleteForResource(resourceId: string): void;

  /** 整体替换该资源的分片，返回写入条数。 */
  replaceForResource(resourceId: string, drafts: readonly ResourceChunkDraft[]): number;
}
