/**
 * 从当前文档的 shadcn 主题变量读取颜色值，构建注入 EPUB iframe 的样式。
 *
 * 后续新增样式直接在本函数追加 CSS 规则即可。
 * 颜色值跟随 shadcn 主题变量，不由这里硬编码。
 *
 * 强制覆盖所有元素文字颜色的原因：EPUB 自身 CSS 给 h1/p/span/div 等设置了具体颜色，若只覆盖 body，这些元素仍保留原色，暗色模式下无法阅读；这是 EPUB 阅读器暗色模式的通用做法，Google Play Books / Kindle 同理。
 */
export function buildReaderCSS(): string {
  const vars = readThemeVars();
  return `
:root {
  --theme-bg-color: ${vars.background};
  color-scheme: light dark;
}
:root,
:root body {
  background-color: ${vars.background} !important;
}
/* 强制所有元素使用主题文字色。选择器带 :root 前缀是为了压过电子书自带的 !important 文字色：通用选择器 * 的特异性为 0，会被书里带 !important 的类型选择器压过。 */
:root body,
:root body * {
  color: ${vars.foreground} !important;
}
/* 链接颜色单独设置 */
:root body a,
:root body a * {
  color: ${vars.primary} !important;
}
/* 图片/媒体等元素还原颜色，避免图片变色。前缀与文字色规则一致，靠声明顺序压过它。 */
:root body img,
:root body svg,
:root body video,
:root body canvas,
:root body object,
:root body embed {
  color: initial !important;
  background-color: initial !important;
}
::selection {
  background: color-mix(in srgb, ${vars.primary} 30%, transparent);
}
`;
}

interface ThemeVars {
  background: string;
  foreground: string;
  primary: string;
}

function readThemeVars(): ThemeVars {
  // 获取当前项目的计算后的style，然后拿属性
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue('--background').trim(),
    foreground: style.getPropertyValue('--foreground').trim(),
    primary: style.getPropertyValue('--primary').trim(),
  };
}
