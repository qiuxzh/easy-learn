import type { AttachmentInsert, AttachmentEntity } from './attachment';

/**
 * 附件的持久化接口。
 *
 * 只负责 attachment 表；文件落盘与删除由附件服务配合处理，两者不在同一个事务里。
 */
export interface AttachmentRepo {
  /** 插入一条附件记录。 */
  insert(input: AttachmentInsert): AttachmentEntity;
  /** 按 id 查询附件记录。 */
  findById(id: string): AttachmentEntity | undefined;
  /** 批量查询附件记录，删除文件前用它定位路径。 */
  findByIds(ids: string[]): AttachmentEntity[];
  /** 删除若干附件记录；磁盘文件由调用方在记录删除后处理。 */
  deleteByIds(ids: string[]): void;
}
