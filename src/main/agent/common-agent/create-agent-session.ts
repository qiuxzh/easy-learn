import type { ThinkingLevel } from '@shared/types/chat';
import type { AgentState } from '../core/agent';
import { Agent } from '../core/agent';
import type { StreamFn } from '../model/stream-fn';
import type { ModelRuntime } from '../model/model-runtime';
import type { Model } from '../model/types';
import type { AgentDefinition } from './agent-definition';
import { AgentSession } from './agent-session';
import { createImageHydrator } from './util/hydrate-images';
import { SessionManager } from './session-manager';

/** Agent 初始状态中由会话决定的字段。 */
type AgentInitialState = Partial<
  Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
>;

/** 组装一次会话所需的输入。除 sessionId 与品类外都有默认行为。 */
export interface CreateAgentSessionOptions {
  /** 所属会话的 id。 */
  sessionId: string;
  /** 品类定义，决定系统提示与工具集。 */
  definition: AgentDefinition;
  /** 模型配置运行时，提供模型查询与流式实现。 */
  modelRuntime: ModelRuntime;
  /** 指定模型；省略时按"日志记录 → 配置默认"取。 */
  model?: Model<any>;
  /** 指定思考级别；省略时交给内核的默认值。思考级别不落日志，重开会话时由调用方重新指定。 */
  thinkingLevel?: ThinkingLevel;
  /** 覆盖流式实现，仅供测试使用。 */
  streamFn?: StreamFn;
}

/**
 * 组装会话：把品类定义、模型配置与会话日志合成一个可运行的 AgentSession。
 * 新建与重建是同一条路径——日志为空即新建，有日志则按日志回放上下文与运行期设置。
 */
export function createAgentSession(options: CreateAgentSessionOptions): AgentSession {
  const { sessionId, definition, modelRuntime } = options;
  const sessionManager = new SessionManager(sessionId);
  const entries = sessionManager.getEntries();
  const isNewSession = entries.length === 0;
  const context = sessionManager.buildContext();

  // 模型优先级：显式指定 → 日志中最近使用的模型 → 配置默认模型
  const model =
    options.model ??
    (context.model
      ? modelRuntime.getModel(context.model.provider, context.model.modelId)
      : undefined) ??
    modelRuntime.getDefaultModel();

  const thinkingLevel = options.thinkingLevel;

  const initialState: AgentInitialState = {
    messages: context.messages,
    systemPrompt: definition.systemPrompt,
    tools: definition.tools ?? [],
  };
  if (model) {
    initialState.model = model;
  }
  if (thinkingLevel !== undefined) {
    initialState.thinkingLevel = thinkingLevel;
  }

  const agent = new Agent({
    initialState,
    streamFn: options.streamFn ?? modelRuntime.createStreamFn(),
    // 图片以落盘路径入上下文，发往模型前在这里读成 base64；模型不支持图片时降级为占位文本
    convertToLlm: createImageHydrator({
      supportsImage: model?.input.includes('image') ?? false,
    }),
  });

  // 新会话记下所用模型，重建时即可按日志回放会话的运行期设置。
  if (isNewSession && model) {
    sessionManager.appendModelChange(model.provider, model.id);
  }

  return new AgentSession({ agent, sessionManager });
}
