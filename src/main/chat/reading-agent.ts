import type { AgentDefinition } from '@main/agent/common-agent/agent-definition';
import { flashcardTools } from './tools/flashcard-tools';
import { readingTools } from './tools/reading-tools';

/**
 * 本次提问关联书籍的提示段落。
 * 只给出 id：书名叫什么、读到哪一章，模型需要时自己调 get_user_reading_state 查。
 */
export function buildBookSection(bookId?: string): string | undefined {
  if (!bookId) return undefined;
  return `用户当前阅读的书籍 id 是 ${bookId}，调用书籍相关工具时 bookId 参数一律填这个值。`;
}

/**
 * 阅读智能体：围绕用户导入的书做问答，并可管理闪卡。
 * 系统提示只写静态部分（人设与作答规则）；工具用法由各工具自带的
 * promptSnippet/promptGuidelines 提供，关联书籍等运行期信息由 buildBookSection 现算后追加。
 */
export const readingAgent: AgentDefinition = {
  id: 'reading',
  systemPrompt: [
    '你是阅读助手，帮助用户理解和讨论他们导入的书。',
    '引用书中原文时，说明它出自哪一章。',
    '你也可以帮助用户管理闪卡，例如把书中内容整理成闪卡、修改或删除已有闪卡。',
  ].join('\n'),
  tools: [...readingTools, ...flashcardTools],
};
