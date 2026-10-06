/**
 * 渲染层的消息模型（App 层）。
 * 与内核的 `AgentMessage`（见 chat.ts）是两套表示：内核负责持久化与上下文组装，
 * 这里只描述界面需要渲染的 part 序列。
 */

import type { Usage } from '@shared/types/chat';

/** App 层文本 part */
export interface AppTextPart {
  type: 'text';
  text: string;
  state?: 'streaming' | 'done' | 'abort'; // 遇到错误或者被中止会设置为abort
}

/** App 层思考 part */
export interface AppReasoningPart {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done' | 'abort';
}

/** App 层工具调用 part */
export interface AppToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: string;
}

/** App 层工具结果 part */
export interface AppToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  input: string;
  output: string;
  success: boolean;
  /**
   * 工具返回的结构化详情，供界面渲染。
   * 形状随工具而异，读取方需按 toolName 判断并做防御性解析；
   * 历史会话里的旧记录没有该字段，为 undefined。
   */
  details?: unknown;
}

/** App 层图片 part：只保存落盘路径，渲染时拼成 app:// 地址 */
export interface AppImagePart {
  type: 'image';
  path: string;
}

// 用户打断时，向当前的assistant message 里面添加一份这个块
export interface AppAbortPart {
  type: 'abort';
}

export interface AppErrorPart {
  type: 'error';
  errorText: string;
}

/**
 * App 层上下文压缩 part：一条独立的系统提示，标记"这里把更早的对话压成了摘要"。
 * 压缩过程中 state 为 streaming，结束后落成 done（或被中断/失败）。
 * 只保留渲染需要的字段——用量、摘要正文都不显示，也就不进 App 层。
 */
export interface AppCompactionPart {
  type: 'compaction';
  state: 'streaming' | 'done' | 'error';
  /** 失败原因，state === 'error' 时才有 */
  errorText?: string;
}

/** App 层消息 part */
export type AppUIMessagePart =
  | AppTextPart
  | AppReasoningPart
  | AppToolCallPart
  | AppToolResultPart
  | AppImagePart
  | AppAbortPart
  | AppErrorPart
  | AppCompactionPart;

/** App 层消息 */
export interface AppUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: AppUIMessagePart[];
  /** 该条助手消息的 token 用量；用户消息、以及尚未收到用量的助手消息为 undefined。 */
  usage?: Usage;
}
