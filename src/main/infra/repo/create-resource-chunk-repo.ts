import { count, eq } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import type { ResourceChunkRepo as ResourceChunkRepoContract } from '@main/contracts/resource-ocr-repo';
import type { ResourceChunkDraft } from '@main/contracts/resource-ocr';
import { resourceChunkTable } from '@main/infra/db/schema';

/** 每批写入的分片数；每行 7 个字段。 */
const INSERT_BATCH_SIZE = 80;

class ResourceChunkRepo {
  constructor(private readonly handle: DbHandle) {}

  count(resourceId: string): number {
    const row = this.handle.db
      .select({ total: count() })
      .from(resourceChunkTable)
      .where(eq(resourceChunkTable.resourceId, resourceId))
      .get();
    return row?.total ?? 0;
  }

  deleteForResource(resourceId: string): void {
    this.handle.db
      .delete(resourceChunkTable)
      .where(eq(resourceChunkTable.resourceId, resourceId))
      .run();
  }

  /**
   * 整体替换一个资源的分片。
   *
   * 删除与写入在同一个事务里完成：中途失败时旧分片仍然可用，不会出现「删了旧的、
   * 新的没写完」的半截状态。
   */
  replaceForResource(resourceId: string, drafts: readonly ResourceChunkDraft[]): number {
    const now = Date.now();
    return this.handle.transaction(() => {
      this.deleteForResource(resourceId);
      if (drafts.length === 0) return 0;

      const rows = drafts.map((draft, index) => ({
        id: crypto.randomUUID(),
        resourceId,
        idx: index,
        text: draft.text,
        locator: draft.locator,
        meta: draft.meta,
        createdAt: now,
      }));

      for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
        this.handle.db
          .insert(resourceChunkTable)
          .values(rows.slice(start, start + INSERT_BATCH_SIZE))
          .run();
      }
      return rows.length;
    });
  }
}

/** 实现类不导出，调用方只依赖 contracts 里的接口。 */
export function createResourceChunkRepo(handle: DbHandle): ResourceChunkRepoContract {
  return new ResourceChunkRepo(handle);
}
