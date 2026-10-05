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

1. Mermaid 使用 `theme: 'base'` 作为基础主题，并配置一组柔和的多色 palette。
2. `themeCSS` 会按节点顺序循环应用默认分色。业务主题可以通过 CSS 变量覆盖颜色，未定义时使用内置 fallback。
3. 组件外层的 CSS 只处理图表背景、边标签和语义高亮节点，不再统一覆盖所有节点颜色。

业务主题可覆盖的节点颜色变量：

- `--mermaid-node-1-fill`、`--mermaid-node-1-border`、`--mermaid-node-1-text`
- `--mermaid-node-2-fill`、`--mermaid-node-2-border`、`--mermaid-node-2-text`
- `--mermaid-node-3-fill`、`--mermaid-node-3-border`、`--mermaid-node-3-text`
- `--mermaid-node-4-fill`、`--mermaid-node-4-border`、`--mermaid-node-4-text`
- `--mermaid-node-5-fill`、`--mermaid-node-5-border`、`--mermaid-node-5-text`
- `--mermaid-node-6-fill`、`--mermaid-node-6-border`、`--mermaid-node-6-text`

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
