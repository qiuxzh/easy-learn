import { type Static, Type } from 'typebox';

/** 阅读器排版配置。 */
export const ReaderConfigSchema = Type.Object({
  /** 正文栏数。只在翻页方式下生效，固定版式（PDF、pre-paginated EPUB）用它选单页/跨页 */
  layout: Type.Optional(Type.Union([Type.Literal('single'), Type.Literal('double')])),
  /** 翻页方式：左右翻页 / 上下滚动。只对流式文档（EPUB）生效 */
  mode: Type.Optional(Type.Union([Type.Literal('paginated'), Type.Literal('scrolled')])),
  /**
   * 固定版式（PDF / pre-paginated EPUB）的缩放方式：
   * `fit-page` 整页适配、`fit-width` 适配宽度、数字为缩放倍率（1 表示 100%）。
   */
  pdfZoom: Type.Optional(
    Type.Union([Type.Literal('fit-page'), Type.Literal('fit-width'), Type.Number()])
  ),
});

/** 由 ReaderConfigSchema 推导出的阅读器配置类型。 */
export type ReaderConfig = Static<typeof ReaderConfigSchema>;

/** 正文栏数。 */
export type ReaderLayout = NonNullable<ReaderConfig['layout']>;

/** 翻页方式。 */
export type ReaderMode = NonNullable<ReaderConfig['mode']>;

/** 固定版式的缩放方式。 */
export type ReaderZoom = NonNullable<ReaderConfig['pdfZoom']>;

/** 手动缩放倍率的可选范围，UI 与适配层共用 */
export const READER_ZOOM_RANGE = { min: 0.5, max: 3, step: 0.1 } as const;
