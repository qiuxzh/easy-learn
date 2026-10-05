import type { TSchema } from 'typebox';
import type { AgentTool } from '../core/agent';

/**
 * agent-session 层使用的工具定义：在内核工具之上追加"用法说明"。
 * 说明只用于组装系统提示，内核执行时不读它，所以不放进 AgentTool。
 */
export interface SessionTool<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends AgentTool<TParameters, TDetails> {
  /** 一句话摘要，进系统提示的可用工具列表；省略则该工具不出现在列表里。 */
  promptSnippet?: string;
  /** 用法要点，进系统提示的指引段。 */
  promptGuidelines?: string[];
}

/**
 * 定义 SessionTool。
 * 与内核的 defineTool 作用相同：保留 parameters 的类型推断，
 * 避免把工具写成独立对象或放进数组时参数退化成 TSchema。
 */
export function defineSessionTool<TParameters extends TSchema, TDetails = unknown>(
  tool: SessionTool<TParameters, TDetails>
): SessionTool<TParameters, TDetails> {
  return tool;
}

/**
 * 智能体品类定义：把"某个场景需要什么样的智能体"收敛成一份数据。
 * 组装会话时按它设置系统提示与工具集，新增品类只需再写一份定义，不必改动运行层。
 */
export interface AgentDefinition {
  /** 品类标识，用于日志与调试。 */
  id: string;
  /** 随每次请求发送的系统提示。 */
  systemPrompt: string;
  /** 该品类可用的工具；省略表示不挂工具。 */
  tools?: SessionTool<any>[];
}
