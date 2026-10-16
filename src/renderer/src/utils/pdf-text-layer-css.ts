/**
 * PDF 文字层样式（pdfjs-dist 官方 viewer 样式的最小子集）。
 *
 * 为什么需要它：pdf.js 的 TextLayer 只生成绝对定位的透明 span，位置与字号由一组 CSS 自定义属性算出，
 * 而这些规则只存在于官方 viewer 的样式表（web/pdf_viewer.css）里；我们的文字层在每页的 blob iframe 内，
 * 宿主页面的样式到不了那里，必须把 CSS 当文本内联进每页的 HTML 骨架。
 *
 * 变量分工：pdf.js 自己只 setProperty 了 --min-font-size、--font-height、--scale-x；
 * --total-scale-factor 与 --scale-round-x/y 由 pdf-book 的渲染函数直接设在 documentElement 上
 * （pdf.js 的 setLayerDimensions 会用它们算文字层容器的宽高）。
 *
 * 来源：pdfjs-dist@6.3.289 的 web/pdf_viewer.css 中 .textLayer 块。
 * 未摘录：viewer 的查找高亮（.highlight*）、程序化选区（.selectionRendering）、触控高亮（.highlighting）、
 * 拖拽端点用的 .endOfContent（裸 TextLayer 不创建该元素，实测 DOM 里没有），以及 -moz- 前缀系列。
 * 升级 pdfjs-dist 时对照该文件核对一次。
 */
const PDF_TEXT_LAYER_CSS = `
.textLayer {
  color-scheme: only light;
  position: absolute;
  inset: 0;
  overflow: clip;
  text-align: initial;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;

  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
  user-select: text;
}

.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  z-index: 1;

  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));

  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.textLayer .markedContent {
  display: contents;
}

.textLayer span[role="img"] {
  user-select: none;
  cursor: default;
}

.textLayer ::selection {
  background: rgba(0 0 255 / 0.25);
  background: color-mix(in srgb, AccentColor, transparent 50%);
  color: transparent;
}

.textLayer br::selection {
  background: transparent;
}
`;

/** 取出文字层样式，供 pdf-book 拼进每页的 iframe 骨架 */
export function buildPdfTextLayerCSS(): string {
  return PDF_TEXT_LAYER_CSS;
}
