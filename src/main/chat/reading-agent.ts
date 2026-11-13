import type { AgentDefinition, SessionTool } from '@main/agent/common-agent/agent-definition';

/** 阅读智能体的系统提示（静态部分）。 */
export const READING_AGENT_SYSTEM_PROMPT = [
  '你是阅读助手，帮助用户理解和讨论他们导入的资料。',
  '你也可以帮助用户管理闪卡，例如把资料内容整理成闪卡、修改或删除已有闪卡。',
].join('\n');

/**
 * 组装阅读智能体：工具由调用方按依赖构造后传入。
 *
 * 系统提示只写静态部分（人设与作答规则）；工具用法由各工具自带的
 * promptSnippet/promptGuidelines 提供。
 *
 * @param tools 资料阅读与闪卡工具的集合
 */
export function createReadingAgent(tools: SessionTool[]): AgentDefinition {
  return { id: 'reading', systemPrompt: READING_AGENT_SYSTEM_PROMPT, tools };
}
