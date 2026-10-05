import type { SessionTool } from '../agent-definition';

/** 组装系统提示所需的输入。 */
export interface BuildSystemPromptOptions {
  /** 品类自带的基础提示词。 */
  basePrompt: string;
  /**
   * 运行期追加的段落，按顺序拼在基础提示词之后。
   * 段落内容由调用方准备（本函数不涉及任何业务）；空值或全空白段落会被跳过。
   */
  sections?: Array<string | undefined>;
  /**
   * 工具自带的提示词元信息，据此生成"可用工具"与"使用指引"两段。
   * 只读取真正用到的三个字段，因此不必传入完整工具。
   */
  tools?: Array<Pick<SessionTool, 'name' | 'promptSnippet' | 'promptGuidelines'>>;
}

/**
 * 生成“可用工具”段。
 *
 * 产物形如：
 * 可用工具：
 * - get_book_tocs：查看某本书的目录结构
 * - search_book_bm25：在指定书中检索正文片段
 */
function formatAvailableTools(tools: BuildSystemPromptOptions['tools']): string | undefined {
  const items = (tools ?? [])
    .map(tool => [tool.name, tool.promptSnippet?.trim()] as const)
    .filter((item): item is readonly [string, string] => Boolean(item[1]))
    .map(([name, snippet]) => `- ${name}：${snippet}`);
  return items.length > 0 ? ['可用工具：', ...items].join('\n') : undefined;
}

/**
 * 生成“使用指引”段。
 *
 * 产物形如：
 * 使用指引：
 * - 回答与书中内容有关的问题时，先用 search_book_bm25 在指定书里检索……
 * - 不确定用户说的是哪本书时，先调用 get_user_reading_state 看当前的阅读状态。
 */
function formatPromptGuidelines(tools: BuildSystemPromptOptions['tools']): string | undefined {
  const guidelines = new Set<string>();
  for (const tool of tools ?? []) {
    for (const guideline of tool.promptGuidelines ?? []) {
      const trimmed = guideline.trim();
      if (trimmed) guidelines.add(trimmed);
    }
  }
  return guidelines.size > 0
    ? ['使用指引：', ...Array.from(guidelines, guideline => `- ${guideline}`)].join('\n')
    : undefined;
}

/**
 * 组装系统提示：基础提示词 → 工具元信息（可用工具、使用指引）→ 运行期段落，段间空一行。
 * 只做拼接、汇总与空段落过滤，因此不含业务知识，可被各品类共用。
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const { basePrompt, sections, tools } = options;
  return [
    basePrompt,
    formatAvailableTools(tools),
    formatPromptGuidelines(tools),
    ...(sections ?? []),
  ]
    .map(section => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}
