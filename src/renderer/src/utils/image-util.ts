/**
 * 图片相关的渲染层工具：渲染层只持有附件 id，通过 app:// 协议按 id 读取。
 */

/** 把附件 id 转成 app:// 地址 */
export function toAttachmentUrl(attachmentId: string): string {
  return `app://attachment-resource/${encodeURIComponent(attachmentId)}`;
}
