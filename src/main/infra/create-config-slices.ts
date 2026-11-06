import type { ConfigService } from './config-service';
import type { EmbeddingConfig, OcrConfig } from '@main/contracts/config';

/**
 * 从配置中心切出 embedding 段的只读视图。
 *
 * @param store 配置中心
 */
export function createEmbeddingConfig(store: ConfigService): EmbeddingConfig {
  return { get: () => store.get('embedding') };
}

/**
 * 从配置中心切出 ocr 段的只读视图。
 *
 * @param store 配置中心
 */
export function createOcrConfig(store: ConfigService): OcrConfig {
  return { get: () => store.get('ocr') };
}
