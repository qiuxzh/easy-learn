import { type Static, Type } from 'typebox';

/**
 * 思考级别取值对照表，键必须落在内核的三个档位上。
 * 每个键都可省略，省略表示该档位由适配器兜底。
 */
export const ThinkingLevelMapSchema = Type.Object(
  {
    off: Type.Optional(Type.String({ minLength: 1 })),
    medium: Type.Optional(Type.String({ minLength: 1 })),
    max: Type.Optional(Type.String({ minLength: 1 })),
  },
  // 禁止未知档位：拼错的键（如 highest）按“配置不合法”处理，避免静默失效
  { additionalProperties: false }
);

/** 单个模型的定义。 */
export const ModelDefinitionSchema = Type.Object({
  /** 模型标识，即请求时传给接口的 model 名 */
  id: Type.String({ minLength: 1 }),
  /** 显示名称，省略时取 id */
  name: Type.Optional(Type.String({ minLength: 1 })),
  /** 接口协议；省略时继承 provider 的 api */
  api: Type.Optional(Type.String({ minLength: 1 })),
  /** 是否支持深度思考，省略时为 false */
  reasoning: Type.Optional(Type.Boolean()),
  /** 思考级别取值对照表 */
  thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
  /** 支持的输入类型，省略时只支持 text */
  input: Type.Optional(Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')]))),
  /** 上下文窗口大小，单位 token */
  contextWindow: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  /** 单次最大输出，单位 token */
  maxTokens: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
});

/** 单个 provider 的定义。 */
export const ProviderConfigSchema = Type.Object({
  /** 显示名称，省略时取 provider 键名 */
  name: Type.Optional(Type.String({ minLength: 1 })),
  /** 接口基础地址 */
  baseUrl: Type.String({ minLength: 1 }),
  /** 接口密钥 */
  apiKey: Type.Optional(Type.String({ minLength: 1 })),
  /** 该 provider 下各模型默认使用的接口协议 */
  api: Type.Optional(Type.String({ minLength: 1 })),
  /** 模型列表，至少一项 */
  models: Type.Array(ModelDefinitionSchema, { minItems: 1 }),
});

/** 默认使用的模型选择。 */
export const ModelsDefaultSelectionSchema = Type.Object({
  /** provider 标识，需与 providers 的键名一致 */
  provider: Type.String({ minLength: 1 }),
  /** 模型 id，需存在于该 provider 的 models 中 */
  model: Type.String({ minLength: 1 }),
});

/** models 配置的根结构，后续可以直接嵌入 AppConfig。 */
export const ModelsConfigSchema = Type.Object({
  default: Type.Optional(ModelsDefaultSelectionSchema),
  /** provider 集合，键名即 provider 标识 */
  providers: Type.Record(Type.String(), ProviderConfigSchema),
});

/** 由 ModelsConfigSchema 推导出的模型配置类型。 */
export type ModelsConfig = Static<typeof ModelsConfigSchema>;

/** 单个 provider 的原始配置类型。 */
export type ProviderConfig = Static<typeof ProviderConfigSchema>;

/** 单个模型的原始配置类型。 */
export type ModelDefinition = Static<typeof ModelDefinitionSchema>;

/** 默认模型选择类型。 */
export type ModelsDefaultSelection = Static<typeof ModelsDefaultSelectionSchema>;
