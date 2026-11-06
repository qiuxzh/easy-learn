import type { AppConfig } from '@shared/config';

/**
 * 模型配置来源。
 *
 * 会话服务只需要"当前有哪些模型"和"配置变了通知我"，不需要整个配置中心；
 * 实现由装配根从 `ConfigService` 适配，调用方不受影响。
 */
export interface ModelConfig {
  /** 当前的模型配置。 */
  getModels(): AppConfig['models'];

  /**
   * 订阅模型配置变化。
   *
   * @param listener 配置真正变化时调用，未变化不会触发
   * @returns 退订函数
   */
  subscribeModels(listener: () => void): () => void;
}
