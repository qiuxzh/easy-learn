import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import type { ResourceOcrPageRepo as ResourceOcrPageRepoContract } from '@main/contracts/resource-ocr-repo';
import type { ResourceOcrPage } from '@main/contracts/resource-ocr';
import type { BookPageBlock } from '@shared/types/ocr';
import { resourceOcrPageTable } from '@main/infra/db/schema';
import type { ResourceOcrPageRow } from '@main/infra/db/schema';

/** 单条语句的 id 数量上限，远低于 SQLite 的变量上限。 */
const BATCH_SIZE = 400;
/** 每批写入的页数；每行 4 个字段。 */
const INSERT_BATCH_SIZE = 200;

class ResourceOcrPageRepo {
  constructor(private readonly handle: DbHandle) {}

  listPageNumbers(resourceId: string): number[] {
    return this.handle.db
      .select({ page: resourceOcrPageTable.page })
      .from(resourceOcrPageTable)
      .where(eq(resourceOcrPageTable.resourceId, resourceId))
      .orderBy(asc(resourceOcrPageTable.page))
      .all()
      .map(row => row.page);
  }

  listPages(resourceId: string, pages?: readonly number[]): ResourceOcrPage[] {
    if (pages && pages.length === 0) return [];
    const condition = pages
      ? and(
          eq(resourceOcrPageTable.resourceId, resourceId),
          inArray(resourceOcrPageTable.page, [...pages])
        )
      : eq(resourceOcrPageTable.resourceId, resourceId);

    return this.handle.db
      .select()
      .from(resourceOcrPageTable)
      .where(condition)
      .orderBy(asc(resourceOcrPageTable.page))
      .all()
      .map(toPage);
  }

  countPages(resourceId: string): number {
    const row = this.handle.db
      .select({ total: count() })
      .from(resourceOcrPageTable)
      .where(eq(resourceOcrPageTable.resourceId, resourceId))
      .get();
    return row?.total ?? 0;
  }

  deletePages(resourceId: string, pages?: readonly number[]): void {
    if (!pages) {
      this.handle.db
        .delete(resourceOcrPageTable)
        .where(eq(resourceOcrPageTable.resourceId, resourceId))
        .run();
      return;
    }
    if (pages.length === 0) return;

    for (let start = 0; start < pages.length; start += BATCH_SIZE) {
      const batch = pages.slice(start, start + BATCH_SIZE);
      this.handle.db
        .delete(resourceOcrPageTable)
        .where(
          and(
            eq(resourceOcrPageTable.resourceId, resourceId),
            inArray(resourceOcrPageTable.page, batch)
          )
        )
        .run();
    }
  }

  insertMany(resourceId: string, pages: readonly ResourceOcrPage[]): void {
    if (pages.length === 0) return;
    const now = Date.now();
    const rows = pages.map(page => ({
      resourceId,
      page: page.page,
      blocks: JSON.stringify(page.blocks),
      updatedAt: now,
    }));

    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      this.handle.db
        .insert(resourceOcrPageTable)
        .values(rows.slice(start, start + INSERT_BATCH_SIZE))
        .onConflictDoUpdate({
          target: [resourceOcrPageTable.resourceId, resourceOcrPageTable.page],
          set: {
            blocks: sql`excluded.blocks`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();
    }
  }
}

function toPage(row: ResourceOcrPageRow): ResourceOcrPage {
  return { page: row.page, blocks: JSON.parse(row.blocks) as BookPageBlock[] };
}

/** 实现类不导出，调用方只依赖 contracts 里的接口。 */
export function createResourceOcrPageRepo(handle: DbHandle): ResourceOcrPageRepoContract {
  return new ResourceOcrPageRepo(handle);
}
