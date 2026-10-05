/**
 * 图片相关的渲染层工具。
 * 图片本体存放在主进程的 dataDir 下，渲染层只持有相对路径，通过 app:// 协议读取。
 */

/**
 * 把落盘图片的相对路径转成 app:// 地址。
 * 逐段编码，避免路径中的空格、中文等字符被协议处理层当作非法路径，同时保留分隔符。
 */
export function toAppImageUrl(path: string): string {
  return `app:///${path.split('/').map(encodeURIComponent).join('/')}`;
}
