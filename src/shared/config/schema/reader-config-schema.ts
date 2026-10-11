import { type Static, Type } from 'typebox';

/** 阅读器排版配置。 */
export const ReaderConfigSchema = Type.Object({
  /** 正文栏数。只在翻页方式下生效，固定版式（PDF、pre-paginated EPUB）忽略 */
  layout: Type.Optional(Type.Union([Type.Literal('single'), Type.Literal('double')])),
  /** 翻页方式：左右翻页 / 上下滚动。只对流式文档（EPUB）生效 */
  mode: Type.Optional(Type.Union([Type.Literal('paginated'), Type.Literal('scrolled')])),
});

/** 由 ReaderConfigSchema 推导出的阅读器配置类型。 */
export type ReaderConfig = Static<typeof ReaderConfigSchema>;

/** 正文栏数。 */
export type ReaderLayout = NonNullable<ReaderConfig['layout']>;

/** 翻页方式。 */
export type ReaderMode = NonNullable<ReaderConfig['mode']>;
