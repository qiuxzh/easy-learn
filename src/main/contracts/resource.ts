/**
 * 资料库条目的领域实体。
 *
 * 目录与文件共用一行：文件夹的 `format` / `blobPath` / `sizeBytes` 为 null。
 */
import type { ResourceFormat, ResourceKind } from '@shared/types/library';

/** 一条资料库条目：目录或文件。 */
export interface ResourceEntity {
  /** 不可变 id，落盘文件名由它派生。 */
  id: string;
  /** 父目录 id；顶层为 null。 */
  parentId: string | null;
  /** 条目类型。 */
  kind: ResourceKind;
  /** 完整名称：文件含扩展名，文件夹即目录名。 */
  name: string;
  /** 文件格式；文件夹为 null。 */
  format: ResourceFormat | null;
  /** 文件相对 data 目录的路径；文件夹为 null。 */
  blobPath: string | null;
  /** 文件字节数；文件夹为 null。 */
  sizeBytes: number | null;
  /** 最近一次在阅读器中打开的时间，Unix 毫秒；从未打开为 null。 */
  lastOpenedAt: number | null;
  /** 是否已收藏。 */
  starred: boolean;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
  /** 最后修改时间，Unix 毫秒。 */
  updatedAt: number;
}

/** 新建条目时提供的字段；时间省略时由仓储填当前时间。 */
export interface ResourceCreate {
  id: string;
  parentId: string | null;
  kind: ResourceKind;
  name: string;
  format: ResourceFormat | null;
  blobPath: string | null;
  sizeBytes: number | null;
  lastOpenedAt?: number | null;
  starred?: boolean;
  createdAt?: number;
  updatedAt?: number;
}
