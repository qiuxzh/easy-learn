import type { AppConfig } from '@shared/config';

/**
 * 向量化配置的只读视图。
 *
 * 消费方只读自己需要的那一段，不接触整个 `ConfigService`，也不具备写权限。
 */
export interface EmbeddingConfig {
  /** 当前生效的 embedding 配置段。 */
  get(): AppConfig['embedding'];
}

/**
 * OCR 配置的只读视图。
 *
 * 消费方只读 `ocr` 段，不接触整个 `ConfigService`。
 */
export interface OcrConfig {
  /** 当前生效的 ocr 配置段。 */
  get(): AppConfig['ocr'];
}
