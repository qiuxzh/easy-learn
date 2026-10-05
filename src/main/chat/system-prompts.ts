import { buildSystemPrompt } from '@main/agent/common-agent/prompt/build-system-prompt';
import { buildBookSection, readingAgent } from '@main/chat/reading-agent';

export const DiagramPrompt = `
绘制图表时遵守以下规则：
- 优先使用 Markdown 的 Mermaid 代码块（\`\`\`mermaid）或 SVG 代码块（\`\`\`svg）绘制图表，不要使用 ASCII 图。
- 使用 SVG 代码块时，如果背景颜色是不必要的，不需要定义 SVG 图像背景；背景由渲染组件提供。
- 禁止使用不安全的 SVG 语法，例如 script 标签、onload/onclick 事件、foreignObject、javascript: 链接和外部资源引用。

Mermaid 示例：
\`\`\`mermaid
flowchart LR
  A[开始] --> B[完成]
\`\`\`

SVG 示例：
\`\`\`svg
<svg viewBox="0 0 180 60" xmlns="http://www.w3.org/2000/svg">
  <circle cx="30" cy="30" r="18" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="58" y="35" font-size="14" fill="#0f172a">节点</text>
</svg>
\`\`\`
`;

export async function buildChatSystemPrompt(bookId?: string) {
  return buildSystemPrompt({
    basePrompt: readingAgent.systemPrompt,
    tools: readingAgent.tools,
    sections: [bookId ? buildBookSection(bookId) : undefined, DiagramPrompt],
  });
}
