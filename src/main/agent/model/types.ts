import { TSchema } from 'typebox';
import type { Api, Message, ProviderId, ThinkingLevel } from '@shared/types/chat';

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

/**
 * 思考级别到接口原始取值的映射。
 * 键为内核的思考级别，值为该级别下发给接口的取值；未声明的档位由适配器兜底。
 */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string>>;

//
export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  /** 该模型下思考级别的取值对照表；模型不支持思考时省略 */
  thinkingLevelMap?: ThinkingLevelMap;
  input: ('text' | 'image')[]; // 是否支持图像
  contextWindow: number;
  maxTokens: number;
}

// 模型发送需要的关键信息
export interface LLMContext {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export type ToolChoice = 'auto' | 'none' | 'required';

/**
 * 调用大模型需要的参数
 */
export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;

  toolChoice?: ToolChoice;
  reasoning?: ThinkingLevel;

  /**
   * Optional metadata to include in API requests.
   * Providers extract the fields they understand and ignore the rest.
   * For example, Anthropic uses `user_id` for abuse tracking and rate limiting.
   */
  metadata?: Record<string, unknown>;

  signal?: AbortSignal;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
