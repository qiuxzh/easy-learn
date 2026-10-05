import { type Static, Type } from 'typebox';
import { ModelsConfigSchema } from './models-config-schema';

/** PaddleOCR 服务配置。 */
export const PaddleOcrConfigSchema = Type.Object({
  /** PaddleOCR 官方 API 的访问令牌 */
  token: Type.Optional(Type.String()),
});

/** 应用级 OCR 配置。 */
export const OcrConfigSchema = Type.Object({
  'paddle-ocr': Type.Optional(PaddleOcrConfigSchema),
});

/** config.json 的根配置结构。 */
export const AppConfigSchema = Type.Object({
  ocr: Type.Optional(OcrConfigSchema),
  models: Type.Optional(ModelsConfigSchema),
});

/** 由 AppConfigSchema 推导出的应用配置类型。 */
export type AppConfig = Static<typeof AppConfigSchema>;
