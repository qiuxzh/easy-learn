/**
 * Vite 资源导入的类型声明。
 *
 * `?url` 后缀让 Vite 把资源当作静态文件处理并返回它的 URL 字符串（dev 是文件路径，
 * 打包后是带 hash 的产物路径）。pdf.js 的 worker 需要的就是这样一个 URL。
 */
declare module '*?url' {
  const url: string;
  export default url;
}
