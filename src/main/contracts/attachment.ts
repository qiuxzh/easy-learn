/** 附件记录：id 到文件位置与元数据的寻址信息。 */
export interface AttachmentEntity {
  /** 附件 id，文件名由它派生。 */
  id: string;
  /** 文件相对 data 目录的路径。 */
  path: string;
  /** 附件种类，目前只有 image。 */
  type: string;
  /** MIME 类型。 */
  mimeType: string;
  /** 文件字节数。 */
  size: number;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
}

/** 新增附件时提供的字段；`createdAt` 省略时由仓储填当前时间。 */
export interface AttachmentInsert extends Omit<AttachmentEntity, 'createdAt'> {
  createdAt?: number;
}
