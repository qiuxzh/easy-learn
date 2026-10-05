import type { AppConfig } from './app-config-schema';
import type { ModelsConfig } from './models-config-schema';

/** models 区块的默认内容。 */
export const DEFAULT_MODELS_CONFIG: ModelsConfig = {
  providers: {},
};

/** config.json 的默认内容。 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  ocr: {
    'paddle-ocr': {
      token: '',
    },
  },
  models: { providers: {} },
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
