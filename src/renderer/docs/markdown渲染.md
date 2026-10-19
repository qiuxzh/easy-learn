# Markdown 渲染

## mermaid

### 渲染

mermaid 渲染通过 Markdown fenced code block 触发，language 为 `mermaid`：

````md
```mermaid

```
````

### 颜色配置

Mermaid 颜色由三层配置组成，优先级从低到高如下。

1. `theme: 'base'` 配合 `themeVariables`，取值来自 `MermaidBlock.tsx` 的 `MERMAID_PALETTES`。
2. `themeCSS` 用同一套配色按节点顺序循环施加分色，节点数超过槽位数就从第一槽重新开始。
3. 组件外层的 CSS（`styles/mermaid.css`）只处理图表背景、边标签和语义高亮节点。

整套配色写在 `MermaidBlock.tsx` 的 `MERMAID_PALETTES`，亮暗各一套；换图表配色只改这个常量。

为什么配色是写死的色值而不是 CSS 变量：mermaid 内部会对 `themeVariables` 做明暗运算，而它依赖的颜色库只认 hex / `rgb()` / `hsl()`，传 `var()` 或 `color-mix()` 派生的值会直接抛 `Unsupported color format`。节点分色也因此无法由外部 CSS 变量覆盖。代价是主题切换后图表必须重新渲染才会换色，这一步由 `useThemeRevision` 监听根节点主题属性触发。

## svg

### 渲染

SVG 渲染通过 Markdown fenced code block 触发，language 为 `svg`：

````md
```svg
<svg ...>...</svg>
```
````

预览使用原始 SVG 创建 Blob URL，再交给 `<img>` 渲染。预览不会把 SVG 栅格化，也不会把原始 SVG 直接注入 DOM。这样可以保留 SVG 的矢量效果，同时避免 SVG 脚本执行。

源码模式始终保留原始代码，可以复制完整 SVG 源码。预览模式不会提供 SVG 内部文字的选择能力；如果需要选择文字，需要切换源码模式，或后续单独引入经过清洗的内联 SVG 方案。

复制图片时会把 SVG 转成 PNG 后写入剪贴板。SVG 会先进行基础校验，包含脚本、事件属性、`foreignObject` 或外部引用时不会进入预览。

### 安全

基础 SVG 校验：

- 非法 XML 不进入预览
- 非 <svg> 根节点不进入预览
- 禁止 <script>
- 禁止 on\* 事件属性
- 禁止 foreignObject
- 禁止远程或其他外部 href 引用
