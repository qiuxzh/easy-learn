import fs from 'node:fs';
import path from 'node:path';
import type { ImageContent } from '@shared/types/chat';
import type {
  EpubDocMeta,
  EpubSectionMeta,
  EpubTocItem,
  PdfDocMeta,
  PdfTocItem,
  ResourceFormat,
} from '@shared/types/library';
import type { FoliateBook } from '@/components/reader/foliate-types';
import type { Paths } from '@main/paths';
import { DomainError } from '@main/domain-error';
import { log } from '@main/logging';
import type { ResourceEntity } from '@main/contracts/resource';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { ResourceOcrPageRepo } from '@main/contracts/resource-ocr-repo';
import type { AttachmentService } from '@main/service/attachment-service';
import { collectPlainText } from '@main/service/etl/chunking/html-text';
import { ocrBlocksToText } from '@main/service/etl/ocr/result';
import { initFoliatePolyfill } from '@main/service/etl/foliate-polyfill';
import { readPdfInfo } from '@main/service/etl/pdf/inspect';
import { readPdfOutline } from '@main/service/etl/pdf/outline';
import {
  readPdfPageTexts,
  renderPdfPagePng,
  type PdfTextPage,
} from '@main/service/etl/pdf/pdf-pages';
import { parseEpubFromBuffer } from '@shared/utils/book-parser';
import { parseEpubDocMeta, parsePdfDocMeta, patchPdfDocMeta, serializeDocMeta } from './doc-meta';
import { readEpubDocMeta } from './epub-doc-meta';
import { readPdfDocMeta } from './pdf-doc-meta';

/** PDF 单次最多返回的页数。 */
export const MAX_PDF_PAGES_PER_READ = 10;

/** 已解析 EPUB 的内存缓存条数；超出后按插入顺序淘汰最旧的一条。 */
const EPUB_CACHE_LIMIT = 3;

export interface PdfTocResult {
  pageCount: number;
  hasTextLayer: boolean;
  items: PdfTocItem[];
}

/** PDF 按页读取的文字结果；`emptyPages` 是没有文本层的页。 */
export interface PdfTextResult {
  resourceId: string;
  name: string;
  pageCount: number;
  startPage: number;
  endPage: number;
  pages: PdfTextPage[];
  emptyPages: number[];
}

/** PDF 按页读取的 OCR 文字结果；`missingPages` 是还没有 OCR 结果的页。 */
export interface PdfOcrTextResult {
  resourceId: string;
  name: string;
  pageCount: number;
  startPage: number;
  endPage: number;
  pages: PdfTextPage[];
  missingPages: number[];
}

/** PDF 单页页面图的读取结果；`image` 已登记为附件。 */
export interface PdfPageImageResult {
  resourceId: string;
  name: string;
  page: number;
  pageCount: number;
  image: ImageContent;
}

/** EPUB 目录项在原始结构上补一个 section 下标。 */
export interface EpubTocViewItem extends Omit<EpubTocItem, 'subitems'> {
  sectionIndex?: number;
  subitems?: EpubTocViewItem[];
}

/** EPUB 的 section 列表项，附带目录标题。 */
export interface EpubSectionView extends EpubSectionMeta {
  tocTitle: string | null;
}

export interface EpubTocResult {
  hasToc: boolean;
  sectionCount: number;
  toc: EpubTocViewItem[];
  sections: EpubSectionView[];
}

/** EPUB 一节的完整正文；窗口截取由工具层处理。 */
export interface EpubSectionContent {
  resourceId: string;
  name: string;
  sectionIndex: number;
  title: string;
  href: string;
  text: string;
  prevSectionIndex: number | null;
  nextSectionIndex: number | null;
}

/** Markdown / 纯文本的完整正文；窗口截取由工具层处理。 */
export interface TextResourceContent {
  resourceId: string;
  name: string;
  text: string;
}

export interface ResourceReaderServiceDeps {
  /** 路径集合，用于定位库内源文件。 */
  paths: Paths;
  resourceRepo: ResourceRepo;
  /** OCR 页块仓储，用于读取 PDF 的 OCR 文字。 */
  ocrPageRepo: ResourceOcrPageRepo;
  /** 附件服务，页面图登记到它。 */
  attachmentService: AttachmentService;
}

/**
 * 资料读取服务：读取文档结构与正文。
 *
 * 只做读取，不改资料库；文件按 `resource.blobPath` 从 data 目录读取。
 * EPUB 解析结果按资源 id 缓存在实例里，最多保留 {@link EPUB_CACHE_LIMIT} 份。
 */
export class ResourceReaderService {
  private readonly paths: Paths;
  private readonly resourceRepo: ResourceRepo;
  private readonly ocrPageRepo: ResourceOcrPageRepo;
  private readonly attachmentService: AttachmentService;

  /** 已解析的 EPUB，key 是 resourceId。 */
  private readonly parsedEpubCache = new Map<string, FoliateBook>();

  constructor(deps: ResourceReaderServiceDeps) {
    this.paths = deps.paths;
    this.resourceRepo = deps.resourceRepo;
    this.ocrPageRepo = deps.ocrPageRepo;
    this.attachmentService = deps.attachmentService;
  }

  /**
   * 读取 PDF 的内置目录。
   *
   * 缓存里没有目录时用 pdf.js 解析并回写；解析失败抛出可直接展示的原因。
   *
   * @throws 资料不是 PDF、文件缺失或 PDF 无法读取时抛出
   */
  async readPdfToc(resourceId: string): Promise<PdfTocResult> {
    const resource = this.requireFile(resourceId, 'pdf');
    const meta = await this.ensurePdfDocMeta(resource);
    return {
      pageCount: meta.pageCount,
      hasTextLayer: meta.hasTextLayer,
      items: meta.toc?.items ?? [],
    };
  }

  /**
   * 按物理页读取 PDF 文本层，不读取 OCR 结果。
   *
   * @param startPage 起始页，从 1 开始
   * @param endPage 结束页，从 1 开始，含；省略时只读 startPage
   * @returns 本次读到的页、总页数与没有文本层的页
   * @throws 资料不是 PDF、页码越界或 PDF 无法读取时抛出
   */
  async readPdfPageText(
    resourceId: string,
    startPage: number,
    endPage?: number
  ): Promise<PdfTextResult> {
    const resource = this.requireFile(resourceId, 'pdf');
    if (!Number.isInteger(startPage) || startPage < 1) {
      throw new DomainError('起始页码必须从 1 开始');
    }
    if (endPage !== undefined && (!Number.isInteger(endPage) || endPage < startPage)) {
      throw new DomainError('结束页码不能小于起始页码');
    }

    const filePath = this.resolveBlob(resource);
    const lastPage = Math.min(endPage ?? startPage, startPage + MAX_PDF_PAGES_PER_READ - 1);

    let report: Awaited<ReturnType<typeof readPdfPageTexts>>;
    try {
      report = await readPdfPageTexts(filePath, startPage, lastPage);
    } catch (error) {
      throw new DomainError(describeError(error));
    }

    return {
      resourceId,
      name: resource.name,
      pageCount: report.pageCount,
      startPage,
      endPage: report.pages[report.pages.length - 1]?.page ?? startPage,
      pages: report.pages,
      emptyPages: report.pages.filter(page => page.text.trim().length === 0).map(page => page.page),
    };
  }

  /**
   * 按物理页读取 PDF 已完成的 OCR 文字，不读取文本层。
   *
   * @param startPage 起始页，从 1 开始
   * @param endPage 结束页，从 1 开始，含；省略时只读 startPage
   * @returns 本次读到的页、总页数与还没有 OCR 结果的页
   * @throws 资料不是 PDF、页码越界或文件缺失时抛出
   */
  async readPdfPageOcrText(
    resourceId: string,
    startPage: number,
    endPage?: number
  ): Promise<PdfOcrTextResult> {
    const resource = this.requireFile(resourceId, 'pdf');
    if (!Number.isInteger(startPage) || startPage < 1) {
      throw new DomainError('起始页码必须从 1 开始');
    }
    if (endPage !== undefined && (!Number.isInteger(endPage) || endPage < startPage)) {
      throw new DomainError('结束页码不能小于起始页码');
    }

    const pageCount = await this.ensurePdfPageCount(resource);
    if (startPage > pageCount) {
      throw new DomainError(`页码超出范围：本书共 ${pageCount} 页`);
    }

    const lastPage = Math.min(
      endPage ?? startPage,
      startPage + MAX_PDF_PAGES_PER_READ - 1,
      pageCount
    );
    const requestedPages: number[] = [];
    for (let page = startPage; page <= lastPage; page += 1) requestedPages.push(page);

    const rows = this.ocrPageRepo.listPages(resourceId, requestedPages);
    const texts = new Map(rows.map(row => [row.page, ocrBlocksToText(row.blocks)]));

    const pages: PdfTextPage[] = [];
    const missingPages: number[] = [];
    for (const page of requestedPages) {
      if (texts.has(page)) {
        pages.push({ page, text: texts.get(page) ?? '' });
      } else {
        pages.push({ page, text: '' });
        missingPages.push(page);
      }
    }

    return {
      resourceId,
      name: resource.name,
      pageCount,
      startPage,
      endPage: lastPage,
      pages,
      missingPages,
    };
  }

  /**
   * 把 PDF 的一页渲染成图片并登记为附件。
   *
   * @param page 页码，从 1 开始
   * @returns 附件引用与总页数；附件由调用方持有
   * @throws 资料不是 PDF、页码越界、渲染或附件写入失败时抛出
   */
  async readPdfPageImage(resourceId: string, page: number): Promise<PdfPageImageResult> {
    const resource = this.requireFile(resourceId, 'pdf');
    if (!Number.isInteger(page) || page < 1) {
      throw new DomainError('页码必须从 1 开始');
    }

    const rendered = await renderPdfPagePng(this.resolveBlob(resource), page);
    const [image] = await this.attachmentService.storeImages([
      { bytes: rendered.png, mimeType: 'image/png' },
    ]);
    if (!image) throw new DomainError('页面图写入附件失败');

    return {
      resourceId,
      name: resource.name,
      page,
      pageCount: rendered.pageCount,
      image,
    };
  }

  /**
   * 读取 EPUB 的结构：原书目录树 + spine 阅读单元。
   *
   * 阅读单元按 xhtml 划分；目录只做章节名映射，读取时不再按锚点切分。
   *
   * @returns 目录树、section 列表与映射后的 section 下标
   * @throws 资料不是 EPUB、文件缺失或结构解析失败时抛出
   */
  async readEpubToc(resourceId: string): Promise<EpubTocResult> {
    const resource = this.requireFile(resourceId, 'epub');
    const meta = await this.ensureEpubDocMeta(resource);
    const sections = meta.sections ?? [];
    const toc = meta.toc ?? [];

    const sectionIndexByHref = new Map<string, number>(
      sections.map(section => [section.href, section.index])
    );
    const viewToc = this.toEpubTocView(toc, sectionIndexByHref);

    const tocTitleBySection = new Map<number, string>();
    const walk = (items: readonly EpubTocViewItem[]): void => {
      for (const item of items) {
        if (item.sectionIndex !== undefined && !tocTitleBySection.has(item.sectionIndex)) {
          tocTitleBySection.set(item.sectionIndex, item.title);
        }
        if (item.subitems?.length) walk(item.subitems);
      }
    };
    walk(viewToc);

    return {
      hasToc: viewToc.length > 0,
      sectionCount: sections.length,
      toc: viewToc,
      sections: sections.map(section => ({
        ...section,
        tocTitle: tocTitleBySection.get(section.index) ?? null,
      })),
    };
  }

  /**
   * 按 xhtml 读取 EPUB 的一节正文。
   *
   * @param sectionIndex spine 下标，从 0 开始
   * @returns 本节完整正文与前后节下标
   * @throws sectionIndex 越界、章节无法解析或 EPUB 读取失败时抛出
   */
  async readEpubSection(resourceId: string, sectionIndex: number): Promise<EpubSectionContent> {
    const resource = this.requireFile(resourceId, 'epub');
    const meta = await this.ensureEpubDocMeta(resource);
    const sections = meta.sections ?? [];
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sections.length) {
      throw new DomainError(`sectionIndex 越界：共 ${sections.length} 节`);
    }

    const book = await this.getParsedEpub(resource);
    const section = book.sections[sectionIndex];
    if (!section) throw new DomainError('章节不存在');
    if (!section.createDocument) throw new DomainError('该章节无法读取正文');

    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch (error) {
      throw new DomainError(`章节解析失败：${describeError(error)}`);
    }

    return {
      resourceId,
      name: resource.name,
      sectionIndex,
      title: sections[sectionIndex].title,
      href: section.id,
      text: extractEpubText(doc),
      prevSectionIndex: sectionIndex > 0 ? sectionIndex - 1 : null,
      nextSectionIndex: sectionIndex + 1 < sections.length ? sectionIndex + 1 : null,
    };
  }

  /**
   * 读取 Markdown / 纯文本全文。
   *
   * @throws 资料不是 Markdown/纯文本、文件缺失或读取失败时抛出
   */
  async readTextResource(resourceId: string): Promise<TextResourceContent> {
    const resource = this.requireFile(resourceId);
    if (resource.format !== 'md' && resource.format !== 'txt') {
      throw new DomainError('该资料不是 Markdown 或纯文本文件');
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(this.resolveBlob(resource), 'utf8');
    } catch (error) {
      throw new DomainError(`无法读取文件：${describeError(error)}`);
    }

    return {
      resourceId,
      name: resource.name,
      text: raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'),
    };
  }

  /** 读 PDF 元数据；目录为空时补解析并回写。 */
  private async ensurePdfDocMeta(resource: ResourceEntity): Promise<PdfDocMeta> {
    const cached = parsePdfDocMeta(this.resourceRepo.findDocMeta(resource.id));
    if (cached && cached.toc !== null) return cached;

    const filePath = this.resolveBlob(resource);
    try {
      if (cached) {
        const outline = await readPdfOutline(filePath);
        return patchPdfDocMeta(this.resourceRepo, resource.id, {
          toc: outline.toc,
          pageLabels: outline.pageLabels,
        });
      }

      const meta = await readPdfDocMeta(filePath);
      this.resourceRepo.setDocMeta(resource.id, serializeDocMeta(meta));
      return meta;
    } catch (error) {
      throw new DomainError(`无法读取 PDF 目录：${describeError(error)}`);
    }
  }

  /** 读 EPUB 结构；缺目录或 section 列表时补解析并回写。 */
  private async ensureEpubDocMeta(resource: ResourceEntity): Promise<EpubDocMeta> {
    const cached = parseEpubDocMeta(this.resourceRepo.findDocMeta(resource.id));
    if (cached && cached.toc !== null && cached.sections !== null) return cached;

    const filePath = this.resolveBlob(resource);
    try {
      const meta = await readEpubDocMeta(filePath);
      this.resourceRepo.setDocMeta(resource.id, serializeDocMeta(meta));
      return meta;
    } catch (error) {
      log.error('[ResourceReader] epub doc meta parse failed:', resource.id, error);
      throw new DomainError(`无法解析 EPUB：${describeError(error)}`);
    }
  }

  /** 取解析后的 EPUB；同一资源在实例内只解析一次。 */
  private async getParsedEpub(resource: ResourceEntity): Promise<FoliateBook> {
    const cached = this.parsedEpubCache.get(resource.id);
    if (cached) return cached;

    try {
      initFoliatePolyfill();
      const buffer = await fs.promises.readFile(this.resolveBlob(resource));
      const parsed = await parseEpubFromBuffer(buffer, { copyBlob: true });

      if (this.parsedEpubCache.size >= EPUB_CACHE_LIMIT) {
        const oldest = this.parsedEpubCache.keys().next().value;
        if (oldest) this.parsedEpubCache.delete(oldest);
      }
      this.parsedEpubCache.set(resource.id, parsed.rawBook);
      return parsed.rawBook;
    } catch (error) {
      log.error('[ResourceReader] epub parse failed:', resource.id, error);
      throw new DomainError(`无法解析 EPUB：${describeError(error)}`);
    }
  }

  /** 读 PDF 页数；只补页数，不解析目录。 */
  private async ensurePdfPageCount(resource: ResourceEntity): Promise<number> {
    const cached = parsePdfDocMeta(this.resourceRepo.findDocMeta(resource.id));
    if (cached) return cached.pageCount;

    const filePath = this.resolveBlob(resource);
    try {
      const info = await readPdfInfo(filePath);
      patchPdfDocMeta(this.resourceRepo, resource.id, {
        pageCount: info.pageCount,
        hasTextLayer: info.hasTextLayer,
      });
      return info.pageCount;
    } catch (error) {
      throw new DomainError(`无法读取 PDF：${describeError(error)}`);
    }
  }

  /** 把目录项映射到 section 下标；匹配不到时省略 `sectionIndex`。 */
  private toEpubTocView(
    items: readonly EpubTocItem[],
    sectionIndexByHref: ReadonlyMap<string, number>
  ): EpubTocViewItem[] {
    return items.map(item => {
      const view: EpubTocViewItem = { ...item };
      const sectionIndex = item.href ? sectionIndexByHref.get(stripFragment(item.href)) : undefined;
      if (sectionIndex !== undefined) view.sectionIndex = sectionIndex;
      if (item.subitems?.length) {
        view.subitems = this.toEpubTocView(item.subitems, sectionIndexByHref);
      }
      return view;
    });
  }

  /** 校验资源是文件且格式匹配。 */
  private requireFile(resourceId: string, format?: ResourceFormat): ResourceEntity {
    const resource = this.resourceRepo.findById(resourceId);
    if (!resource) throw new DomainError('资料不存在');
    if (resource.kind !== 'file') throw new DomainError('该 id 不是文件');
    if (format && resource.format !== format) {
      throw new DomainError(`该资料不是 ${format.toUpperCase()} 文件`);
    }
    if (!resource.blobPath) throw new DomainError('资料文件不存在');
    return resource;
  }

  /** @throws 库内文件不存在时抛出，调用方应把它当作资料缺失。 */
  private resolveBlob(resource: ResourceEntity): string {
    if (!resource.blobPath) throw new DomainError('资料文件不存在');

    const filePath = path.join(this.paths.dataDir, resource.blobPath);
    if (!fs.existsSync(filePath)) {
      throw new DomainError('资料文件不存在，可能已被移动或删除');
    }
    return filePath;
  }
}

/** EPUB 目录 href 可能带 `#fragment`，映射 section 时只看文件部分。 */
function stripFragment(href: string): string {
  return href.split('#')[0];
}

/** @returns 纯文本；块级元素之间保留空行。 */
function extractEpubText(doc: Document): string {
  return collectPlainText(doc.documentElement ?? doc)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
