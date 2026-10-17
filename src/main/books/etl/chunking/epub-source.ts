import { fromRange, joinIndir } from 'foliate-js/epubcfi.js';
import { isSupportedImageExtension } from '@shared/utils/file-util';
import { collectTextUnits, type DomAnchor } from './html-text';
import { LocatorScheme, type LocatorCodec } from './locator';
import type { AnchorPoint, DocumentSource, SegmentInfo, TextUnit } from './types';
import type { FoliateBook, FoliateSection } from '@/components/reader/foliate-types';

/** 可加载正文的 section：createDocument 必定存在，由 listSegments 过滤保证。 */
interface LoadableSection extends FoliateSection {
  createDocument: () => Document | Promise<Document>;
}

/** EPUB 的文档单元：一个 spine section，额外带上生成 CFI 需要的节级基础 CFI。 */
export interface EpubSegment extends SegmentInfo {
  /** 本次要加载正文的 section */
  section: LoadableSection;
  /** foliate-js 给出的节级基础 CFI（'!' 之前的部分）；缺失时只能用 section 下标兜底 */
  baseCfi: string | null;
}

/**
 * 创建 EPUB 文档源。
 * 单元即 spine 顺序上的 section，单元下标与 foliate-js 的 sections 下标一致。
 * @param book foliate-js 解析出的书籍对象
 */
export function createEpubSource(book: FoliateBook): DocumentSource<EpubSegment> {
  const codec = createEpubLocatorCodec();

  return {
    /** 枚举可切分的 section：没有 createDocument 的 section 取不到正文，直接跳过。 */
    async listSegments(): Promise<EpubSegment[]> {
      return book.sections.flatMap((section, index) => {
        if (!isLoadableSection(section)) return [];
        return [
          {
            index,
            id: section.id,
            section,
            baseCfi: section.cfi ?? null,
            // 节级兜底：有节级 CFI 就用它，否则用 foliate-js 的 section 下标定位。
            fallbackLocator: section.cfi ?? `${LocatorScheme.epubSection}${index}`,
          },
        ];
      });
    },

    /** 加载 section 文档并抽取文本单元；锚点指向这份新文档，仅在本次切分内有效。 */
    async loadTextUnits(segment: EpubSegment): Promise<TextUnit[]> {
      const document = await segment.section.createDocument();
      return collectTextUnits(document.documentElement, element =>
        buildPictureUnit(element, segment.id)
      );
    },

    /** 把 DOM 文本位置编码成 EPUB CFI；锚点形态不对时交给编排层降级。 */
    encodeLocator(segment: EpubSegment, anchor: AnchorPoint): string | null {
      if (!isDomAnchor(anchor)) return null;
      return codec.encode(segment, anchor);
    },
  };
}

/**
 * 创建 EPUB 定位编解码器。
 * 需要节级基础 CFI 才能拼出完整 CFI，缺少时返回 null。
 */
export function createEpubLocatorCodec(): LocatorCodec<EpubSegment, DomAnchor> {
  return {
    encode(segment: EpubSegment, anchor: DomAnchor): string | null {
      if (!segment.baseCfi) return null;
      return joinIndir(segment.baseCfi, fromRange(toCollapsedRange(anchor)));
    },
  };
}

/** 把 <img> 的 src 解析成 zip 内资源路径；非图片或解析不出时返回 null */
export function resolvePictureKey(sectionHref: string, src: string): string | null {
  const trimmed = src.trim();
  // data: / http: / blob: 等不是 zip 内资源，直接忽略
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  try {
    // 分两步构造：sectionHref 本身可能含空格等需要编码的字符，直接拼进 base 会被截断
    const base = new URL(sectionHref, 'https://epub.local/');
    const pathname = new URL(trimmed, base).pathname;
    const key = decodeURIComponent(pathname.replace(/^\//, ''));
    const dot = key.lastIndexOf('.');
    const extension = dot === -1 ? '' : key.slice(dot);
    return isSupportedImageExtension(extension) ? key : null;
  } catch {
    return null;
  }
}

/**
 * 把 <img> 解析成一个不可拆分的占位文本单元。
 * 单元只有整块才进分片，key 不会被分片边界切断。
 * @param element 待判定的元素，非图片返回 undefined
 * @param sectionHref 图片所在 section 的 zip 内路径，作为相对引用的基准
 */
export function buildPictureUnit(element: Element, sectionHref: string): TextUnit | undefined {
  const tagName = element.nodeName.toLowerCase();
  // 兼容带命名空间前缀的文档（与 formula.ts 的 math 判断一致）
  if (tagName !== 'img' && !tagName.endsWith(':img')) return undefined;

  const src = element.getAttribute('src');
  if (!src) return undefined;

  const key = resolvePictureKey(sectionHref, src);
  if (!key) return undefined;

  const alt = element.getAttribute('alt')?.replace(/\s+/g, ' ').trim();
  const anchor = { node: element, offset: 0 };
  return {
    value: alt ? `[[picture bookImage:${key} alt:${alt}]]` : `[[picture bookImage:${key}]]`,
    start: anchor,
    end: anchor,
  };
}

/** 判断 section 是否能加载出文档。 */
function isLoadableSection(section: FoliateSection): section is LoadableSection {
  return typeof section.createDocument === 'function';
}

/** 判断锚点是否为 DOM 文本位置，作为文档源接受外部锚点的运行时校验。 */
function isDomAnchor(anchor: AnchorPoint): anchor is DomAnchor {
  return typeof anchor === 'object' && anchor !== null && 'node' in anchor && 'offset' in anchor;
}

/**
 * 把单个文本位置转成折叠 Range。
 * foliate-js 只读取 Range 的边界字段，用折叠 Range 即可生成单个可导航位置。
 */
function toCollapsedRange(anchor: DomAnchor) {
  return {
    startContainer: anchor.node,
    startOffset: anchor.offset,
    endContainer: anchor.node,
    endOffset: anchor.offset,
    collapsed: true,
  };
}
