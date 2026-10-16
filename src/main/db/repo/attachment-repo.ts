import { inArray } from 'drizzle-orm';
import { getDatabase } from '..';
import { attachmentTable } from '../schema';
import type { AttachmentRow, InsertAttachmentRow } from '../schema';

/**
 * 附件的数据访问。
 *
 * 附件行与磁盘文件一一对应：插入一行之前文件必须已经落盘，
 * 删除时行与文件由调用方（附件服务）配合处理——这里只管表。
 */
export class AttachmentRepo {
  /** 插入一条附件记录 */
  insert(data: InsertAttachmentRow): AttachmentRow {
    const rows = getDatabase().insert(attachmentTable).values(data).returning().all();
    return rows[0];
  }

  /** 按主键取一条附件记录 */
  findById(id: string): AttachmentRow | undefined {
    return getDatabase()
      .select()
      .from(attachmentTable)
      .where(inArray(attachmentTable.id, [id]))
      .get();
  }

  /** 批量取若干附件记录，删除文件前用它定位路径 */
  findByIds(ids: string[]): AttachmentRow[] {
    if (ids.length === 0) return [];
    return getDatabase()
      .select()
      .from(attachmentTable)
      .where(inArray(attachmentTable.id, ids))
      .all();
  }

  /** 删除若干附件记录，文件由调用方在事务提交后删除 */
  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;
    getDatabase().delete(attachmentTable).where(inArray(attachmentTable.id, ids)).run();
  }
}

export const attachmentRepo = new AttachmentRepo();
