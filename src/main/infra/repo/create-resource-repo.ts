import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { ResourceCreate } from '@main/contracts/resource';
import type { ResourceListOptions } from '@shared/types/library';
import { resourceTable } from '@main/infra/db/schema';

/** 单条 SQL 语句的 id 数量上限，远低于 SQLite 的变量上限。 */
const BATCH_SIZE = 400;

/** 把父目录条件翻译成 SQL：null 表示顶层。 */
function parentCondition(parentId: string | null) {
  return parentId === null ? isNull(resourceTable.parentId) : eq(resourceTable.parentId, parentId);
}

/** 把排序字段翻译成列；未知值回落到名称。 */
function sortColumn(sort: ResourceListOptions['sort']) {
  if (sort === 'size') return resourceTable.sizeBytes;
  if (sort === 'updatedAt') return resourceTable.updatedAt;
  return resourceTable.name;
}

/** 按格式过滤时保留文件夹，只筛掉不匹配的文件。 */
function formatCondition(formats: ResourceListOptions['formats']) {
  if (!formats || formats.length === 0) return undefined;
  return or(
    eq(resourceTable.kind, 'folder'),
    and(eq(resourceTable.kind, 'file'), inArray(resourceTable.format, formats))
  );
}

/**
 * 创建资料库条目仓储。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createResourceRepo(handle: DbHandle): ResourceRepo {
  return {
    create: (data: ResourceCreate) => {
      const now = Date.now();
      return handle.db
        .insert(resourceTable)
        .values({
          id: data.id,
          parentId: data.parentId,
          kind: data.kind,
          name: data.name,
          format: data.format,
          blobPath: data.blobPath,
          sizeBytes: data.sizeBytes,
          docMeta: data.docMeta ?? null,
          lastOpenedAt: data.lastOpenedAt ?? null,
          starred: data.starred ?? false,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
        })
        .returning()
        .get();
    },

    findById: id => handle.db.select().from(resourceTable).where(eq(resourceTable.id, id)).get(),

    listChildren: (parentId, options) => {
      const formatFilter = formatCondition(options?.formats);
      const condition = formatFilter
        ? and(parentCondition(parentId), formatFilter)
        : parentCondition(parentId);
      const direction = options?.direction === 'desc' ? desc : asc;

      return handle.db
        .select()
        .from(resourceTable)
        .where(condition)
        .orderBy(
          sql`CASE WHEN ${resourceTable.kind} = 'folder' THEN 0 ELSE 1 END`,
          direction(sortColumn(options?.sort))
        )
        .all();
    },

    countChildrenByParents: parentIds => {
      const counts: Record<string, number> = {};
      for (let start = 0; start < parentIds.length; start += BATCH_SIZE) {
        const batch = parentIds.slice(start, start + BATCH_SIZE);
        const rows = handle.db
          .select({ parentId: resourceTable.parentId, count: sql<number>`count(*)` })
          .from(resourceTable)
          .where(inArray(resourceTable.parentId, batch))
          .groupBy(resourceTable.parentId)
          .all();
        for (const row of rows) {
          if (row.parentId !== null) counts[row.parentId] = row.count;
        }
      }
      return counts;
    },

    listStarredResources: limit =>
      handle.db
        .select()
        .from(resourceTable)
        .where(eq(resourceTable.starred, true))
        .orderBy(asc(resourceTable.name))
        .limit(limit)
        .all(),

    sumFileSize: () => {
      const row = handle.db
        .select({ total: sql<number>`COALESCE(SUM(${resourceTable.sizeBytes}), 0)` })
        .from(resourceTable)
        .get();
      return row?.total ?? 0;
    },

    findChildByName: (parentId, name) =>
      handle.db
        .select()
        .from(resourceTable)
        .where(and(parentCondition(parentId), eq(resourceTable.name, name)))
        .get(),

    updateName: (id, name, updatedAt) => {
      handle.db
        .update(resourceTable)
        .set({ name, updatedAt })
        .where(eq(resourceTable.id, id))
        .run();
    },

    updateParent: (id, parentId, updatedAt) => {
      handle.db
        .update(resourceTable)
        .set({ parentId, updatedAt })
        .where(eq(resourceTable.id, id))
        .run();
    },

    findDocMeta: id => {
      const row = handle.db
        .select({ docMeta: resourceTable.docMeta })
        .from(resourceTable)
        .where(eq(resourceTable.id, id))
        .get();
      return row?.docMeta ?? null;
    },

    setDocMeta: (id, docMeta) => {
      handle.db.update(resourceTable).set({ docMeta }).where(eq(resourceTable.id, id)).run();
    },

    setStarred: (id, starred) => {
      handle.db.update(resourceTable).set({ starred }).where(eq(resourceTable.id, id)).run();
    },

    deleteByIds: ids => {
      for (let start = 0; start < ids.length; start += BATCH_SIZE) {
        const batch = ids.slice(start, start + BATCH_SIZE);
        handle.db.delete(resourceTable).where(inArray(resourceTable.id, batch)).run();
      }
    },
  };
}
