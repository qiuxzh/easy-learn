import type { AnchorPoint, SegmentInfo } from './types';

/**
 * 定位串的 scheme 前缀。
 *
 * 定位串自带前缀，消费方按前缀分派跳转实现，因此不需要额外的类型字段，
 * book_chunk 表也不必为「这是块级定位还是单元级兜底」新增列。
 */
export const LocatorScheme = {
  /** 标准 EPUB CFI，foliate-js 的 goTo 直接消费 */
  epubCfi: 'epubcfi(',
  /** EPUB 节级兜底定位：冒号后是 foliate-js 的 section 下标，渲染层应转换为 goTo(index) */
  epubSection: 'epubsec:',
} as const;

/**
 * 定位编解码器：锚点（内存活对象）与定位串（持久化字符串）互转的唯一真相源。
 *
 * 锚点依赖文档源本次加载出来的文档，切分循环一结束即失效，
 * 因此 encode 必须在切分循环内调用。
 */
export interface LocatorCodec<TSegment extends SegmentInfo, TAnchor extends AnchorPoint> {
  /** 锚点 → 持久化定位串；编码不出时返回 null */
  encode(segment: TSegment, anchor: TAnchor): string | null;
}
