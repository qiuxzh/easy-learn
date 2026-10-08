import { type Static, Type } from 'typebox';

/**
 * 单个向量模型的配置，即 models 字典里的一项。
 * 条目的名称不在这里：名称就是它在字典里的键名，值里不再重复一份。
 */
export const EmbeddingModelSchema = Type.Object({
  /** 模型标识，即请求时传给接口的 model 名 */
  modelId: Type.String({ minLength: 1 }),
  /** 完整的 embeddings 请求地址，由用户填写，代码不做拼接 */
  endpoint: Type.String({ minLength: 1 }),
  /** 接口密钥；本地服务可以留空 */
  apiKey: Type.Optional(Type.String()),
  /** 端点测试探测到的向量维度，未测试时为空 */
  dimension: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
});

/** embedding 配置的根结构。 */
export const EmbeddingConfigSchema = Type.Object({
  /**
   * 已配置的向量模型，键名即模型名称。
   * 名称必须唯一，该约束由写入方（设置页）保证；手工编辑时写出同名键不会报错，
   * JSON 解析只会静默保留最后一个，所以不要手动制造重名。
   */
  models: Type.Record(Type.String({ minLength: 1 }), EmbeddingModelSchema),
  /**
   * 当前使用的模型名称，即 models 的键名。
   * 缺省或指向不存在的名称时表示「没有当前使用的模型」，使用方按未配置处理。
   * 这里刻意不做「取第一个」的兜底：那会让使用方与设置页的显示不一致。
   */
  selected: Type.Optional(Type.String({ minLength: 1 })),
});

/** 单个向量模型的配置类型（不含名称，名称在字典的键上）。 */
export type EmbeddingModelEntry = Static<typeof EmbeddingModelSchema>;

/** embedding 配置类型。 */
export type EmbeddingConfig = Static<typeof EmbeddingConfigSchema>;
