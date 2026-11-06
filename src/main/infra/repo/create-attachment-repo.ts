import { inArray } from 'drizzle-orm';
import { attachmentTable } from '@main/infra/db/schema';
import type { AttachmentEntity } from '@main/contracts/attachment';
import type { AttachmentRepo } from '@main/contracts/attachment-repo';
import type { DbHandle } from '@main/infra/db/connection';

/**
 * 创建附件仓储。
 *
 * 行与磁盘文件一一对应：插入一行之前文件必须已经落盘；删除时行与文件由附件服务配合处理，这里只管表。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createAttachmentRepo(handle: DbHandle): AttachmentRepo {
  return {
    insert: input => {
      const rows = handle.db.insert(attachmentTable).values(input).returning().all();
      return toAttachmentEntity(rows[0]);
    },

    findById: id =>
      toRecordOrUndefined(
        handle.db
          .select()
          .from(attachmentTable)
          .where(inArray(attachmentTable.id, [id]))
          .get()
      ),

    findByIds: ids => {
      if (ids.length === 0) return [];
      return handle.db
        .select()
        .from(attachmentTable)
        .where(inArray(attachmentTable.id, ids))
        .all()
        .map(toAttachmentEntity);
    },

    deleteByIds: ids => {
      if (ids.length === 0) return;
      handle.db.delete(attachmentTable).where(inArray(attachmentTable.id, ids)).run();
    },
  };
}

/** 行转换为记录；列名与记录字段一一对应，无需重命名。 */
function toAttachmentEntity(row: typeof attachmentTable.$inferSelect): AttachmentEntity {
  return {
    id: row.id,
    path: row.path,
    type: row.type,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
  };
}

/** 查询可能没有结果，把 undefined 原样交给调用方。 */
function toRecordOrUndefined(
  row: typeof attachmentTable.$inferSelect | undefined
): AttachmentEntity | undefined {
  return row ? toAttachmentEntity(row) : undefined;
}
