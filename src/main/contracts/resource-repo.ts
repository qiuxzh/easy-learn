import type { ResourceCreate, ResourceEntity } from './resource';
import type { ResourceListOptions } from '@shared/types/library';

/** resource 表的持久化接口。 */
export interface ResourceRepo {
  /** 新建条目并返回落库后的记录。 */
  create(data: ResourceCreate): ResourceEntity;

  /** 按 id 查询。 */
  findById(id: string): ResourceEntity | undefined;

  /** 列出某目录的直接子项：文件夹在前，同类按条件排序；`parentId` 为 null 表示顶层。 */
  listChildren(parentId: string | null, options?: ResourceListOptions): ResourceEntity[];

  /** 批量统计文件夹的直接子项数，按父目录 id 索引。 */
  countChildrenByParents(parentIds: string[]): Record<string, number>;

  /** 按名称平铺全部文件，用于「全部资料」。 */
  listAllFiles(limit: number, offset: number): ResourceEntity[];

  /** 按最近打开时间倒序列出文件。 */
  listRecentFiles(limit: number): ResourceEntity[];

  /** 列出收藏的条目（文件与文件夹）。 */
  listStarredResources(limit: number): ResourceEntity[];

  /** 全部文件的字节数之和。 */
  sumFileSize(): number;

  /** 按同级名称查询，用于重名校验。 */
  findChildByName(parentId: string | null, name: string): ResourceEntity | undefined;

  /** 更新名称与修改时间。 */
  updateName(id: string, name: string, updatedAt: number): void;

  /** 更新父目录与修改时间。 */
  updateParent(id: string, parentId: string | null, updatedAt: number): void;

  /** 记录最近打开时间。 */
  markOpened(id: string, openedAt: number): void;

  /** 更新收藏状态。 */
  setStarred(id: string, starred: boolean): void;

  /** 按 id 批量删除记录；不处理磁盘文件。 */
  deleteByIds(ids: string[]): void;
}
