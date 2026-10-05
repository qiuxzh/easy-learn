import { Compile } from 'typebox/compile';
import type { TLocalizedValidationError } from 'typebox/error';
import {
  MODEL_DEFAULTS,
  ModelsConfigSchema,
  type ModelDefinition,
  type ModelsConfig,
  type ModelsDefaultSelection,
  type ProviderConfig,
} from '@shared/config';
import type { Api } from '@shared/types/chat';
import { createOpenAiCompletionsStreamFn } from './api/openai-completions';
import { createFailedStream, type StreamFn } from './stream-fn';
import type { Model } from './types';

/** 向某个 provider 发起请求所需的授权信息。 */
export interface ProviderAuth {
  apiKey?: string;
  baseUrl: string;
}

/**
 * 模型配置的读取函数，由调用方注入。
 * 运行时自身不接触文件系统，配置从哪里来由外部决定。
 */
export type ModelConfigLoader = () => unknown;
/** 把模型配置 schema 编译成校验器。 */
const validateModelsConfig = Compile(ModelsConfigSchema);

/**
 * 把 typebox 的校验错误转成 "providers.deepseek.models.0.id: ..." 形式的可读路径
 */
function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === 'required') {
    const required = (error.params as { requiredProperties?: string[] }).requiredProperties?.[0];
    if (required) {
      const base = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return base ? `${base}.${required}` : required;
    }
  }
  return error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'root';
}

/**
 * 把 json 中的一条模型配置补全默认值，转成运行时使用的 Model
 */
function toModel(
  providerId: string,
  provider: ProviderConfig,
  definition: ModelDefinition
): Model<Api> {
  return {
    id: definition.id,
    name: definition.name ?? definition.id,
    api: definition.api ?? provider.api ?? MODEL_DEFAULTS.api,
    provider: providerId,
    baseUrl: provider.baseUrl,
    reasoning: definition.reasoning ?? MODEL_DEFAULTS.reasoning,
    thinkingLevelMap: definition.thinkingLevelMap,
    input: definition.input ?? [...MODEL_DEFAULTS.input],
    contextWindow: definition.contextWindow ?? MODEL_DEFAULTS.contextWindow,
    maxTokens: definition.maxTokens ?? MODEL_DEFAULTS.maxTokens,
  };
}

/**
 * 模型配置内容的解析与查询入口。
 * 配置非法（读取失败、JSON 解析失败、字段校验不通过）时视为空配置，
 * 通过 getError() 暴露原因，不影响应用继续运行。
 */
export class ModelRuntime {
  private readonly load: ModelConfigLoader;
  /** 各 api 协议对应的流式实现，键即 Model.api */
  private readonly streamFns: Record<string, StreamFn> = {
    'openai-completions': createOpenAiCompletionsStreamFn(provider => this.getAuth(provider)),
  };
  private providers = new Map<string, ProviderConfig>();
  private defaultSelection: ModelsDefaultSelection | undefined;
  private loadError: string | undefined;

  private constructor(load: ModelConfigLoader) {
    this.load = load;
  }

  /**
   * 创建运行时并完成首次加载
   */
  static create(load: ModelConfigLoader): ModelRuntime {
    const runtime = new ModelRuntime(load);
    runtime.reload();
    return runtime;
  }

  /**
   * 重新读取配置，并把结果替换到当前实例
   */
  reload(): void {
    this.providers = new Map();
    this.defaultSelection = undefined;
    this.loadError = undefined;

    let raw: unknown;
    try {
      raw = this.load();
    } catch (error) {
      this.loadError = `模型配置读取失败: ${error instanceof Error ? error.message : error}`;
      return;
    }

    if (!validateModelsConfig.Check(raw)) {
      const details =
        validateModelsConfig
          .Errors(raw)
          .map(error => `  - ${formatValidationPath(error)}: ${error.message}`)
          .join('\n') || '未知的校验错误';
      this.loadError = `模型配置不合法:\n${details}`;
      return;
    }

    const config = raw as ModelsConfig;
    this.providers = new Map(Object.entries(config.providers));
    this.defaultSelection = config.default;
  }

  /**
   * 返回最近一次加载失败的原因，配置正常时为 undefined
   */
  getError(): string | undefined {
    return this.loadError;
  }

  /**
   * 列出所有已配置的 provider 标识
   */
  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * 列出模型；传入 providerId 时只返回该 provider 下的模型
   */
  listModels(providerId?: string): Model<Api>[] {
    const entries = providerId
      ? ([[providerId, this.providers.get(providerId)]] as [string, ProviderConfig | undefined][])
      : [...this.providers.entries()];

    const models: Model<Api>[] = [];
    for (const [id, provider] of entries) {
      if (!provider) continue;
      for (const definition of provider.models) {
        models.push(toModel(id, provider, definition));
      }
    }
    return models;
  }

  /**
   * 按 provider 标识与模型 id 查找模型
   */
  getModel(providerId: string, modelId: string): Model<Api> | undefined {
    const provider = this.providers.get(providerId);
    const definition = provider?.models.find(model => model.id === modelId);
    if (!provider || !definition) return undefined;
    return toModel(providerId, provider, definition);
  }

  /**
   * 取某个 provider 的授权信息，供发起请求时使用
   */
  getAuth(providerId: string): ProviderAuth | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;
    return { apiKey: provider.apiKey, baseUrl: provider.baseUrl };
  }

  /**
   * 取启动时默认使用的模型。
   * json 未声明 default 或声明无效时，退回到第一个可用的模型
   */
  getDefaultModel(): Model<Api> | undefined {
    if (this.defaultSelection) {
      const model = this.getModel(this.defaultSelection.provider, this.defaultSelection.model);
      if (model) return model;
    }
    return this.listModels()[0];
  }

  /**
   * 产出 Agent 使用的流式函数：每次调用按传入模型的 api 选择协议实现。
   * 未注册的协议不抛异常，而是产出一条以 error 收尾的事件流
   */
  createStreamFn(): StreamFn {
    return (model, context, options) => {
      const impl = this.streamFns[model.api];
      if (!impl) return createFailedStream(model, `不支持的 api 协议 "${model.api}"`);
      return impl(model, context, options);
    };
  }
}
