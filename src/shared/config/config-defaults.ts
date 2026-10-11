import type { AppConfig } from './schema/app-config-schema';
import type { EmbeddingConfig } from './schema/embedding-config-schema';
import type { ModelsConfig } from './schema/models-config-schema';
import type { ReaderConfig } from './schema/reader-config-schema';

/** models 区块的默认内容。 */
export const DEFAULT_MODELS_CONFIG: ModelsConfig = {
  providers: {},
};

/** embedding 区块的默认内容：未配置任何向量模型。 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  models: {},
};

/** reader 区块的默认内容：翻页 + 单栏。 */
export const DEFAULT_READER_CONFIG: ReaderConfig = {
  layout: 'single',
  mode: 'paginated',
};

/** config.json 的默认内容。 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  ocr: {
    'paddle-ocr': {
      token: '',
    },
  },
  models: DEFAULT_MODELS_CONFIG,
  embedding: DEFAULT_EMBEDDING_CONFIG,
  reader: DEFAULT_READER_CONFIG,
};

/** 模型字段未声明时使用的默认值。 */
export const MODEL_DEFAULTS = {
  reasoning: false,
  /** 不配置时默认不支持图像 */
  input: ['text'] as ('text' | 'image')[],
  api: 'openai-completions',
  contextWindow: 128000,
  /** 最大输出 token，过小可能在 thinking 时被截断 */
  maxTokens: 128000,
};
