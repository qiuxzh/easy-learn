import JSZip from 'jszip';
import { EPUB } from 'foliate-js/epub.js';
import type { FoliateBook, FoliateMetadata } from '@/components/reader/foliate-types';
import type { CoverImage } from '@shared/types/books';
import { makeZipLoader } from './loader';
import { flattenToc } from './toc';
import { extractAuthor } from './author';
import type { ParsedEpub, ParseEpubOptions, EpubBufferInput } from './types';

/**
 * 从 ArrayBuffer / Uint8Array 解析 EPUB。
 * 浏览器（fetch 返回 ArrayBuffer）和主进程（fs.readFile 返回 Buffer，是 Uint8Array 子类）共用。
 * jsdom 场景下传 { copyBlob: true }。
 */
export async function parseEpubFromBuffer(
  buffer: EpubBufferInput,
  options: ParseEpubOptions = {}
): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer as ArrayBuffer);
  return parseEpubFromZip(zip, options);
}

/**
 * 从已加载的 JSZip 解析 EPUB，避免重复 load。
 * 主进程提取封面时（需要复用同一个 zip）用这个入口。
 */
export async function parseEpubFromZip(
  zip: JSZip,
  options: ParseEpubOptions = {}
): Promise<ParsedEpub> {
  const loader = makeZipLoader(zip, { copyBlob: options.copyBlob });
  const book = (await new EPUB(loader).init()) as FoliateBook;

  const metadata = book.metadata as FoliateMetadata;
  return {
    rawBook: book,
    tocs: flattenToc(book.toc ?? []),
    metadata: {
      title: typeof metadata.title === 'string' ? metadata.title : '',
      author: extractAuthor(metadata) ?? (await extractOpfFallbackAuthor(zip)),
      totalChapters: book.sections?.length ?? 0,
    },
  };
}

/**
 * 直接从 OPF XML 提取 calibre 扩展的作者字段。
 * foliate-js 只把 <meta name="..."> 收集到临时对象，未合并到 metadata.author，
 * 但 calibre 转换的电子书（如很多中文资源）作者通常在 <meta name="calibre:author">。
 */
async function extractOpfFallbackAuthor(zip: JSZip): Promise<string | undefined> {
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) return undefined;
  const opfPath = containerXml.match(/<rootfile[^>]+full-path="([^"]+)"/)?.[1];
  if (!opfPath) return undefined;
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) return undefined;

  // 优先级：calibre:author > author（calibre legacy meta）
  for (const name of ['calibre:author', 'author']) {
    const re = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i');
    const match = opfXml.match(re);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

/**
 * 从 JSZip 中按 cover href 提取封面图片字节 + 扩展名。
 * 导入流程专用：BookService 拿到 parseEpubFromBuffer 结果后单独调一次，避免所有调用方都付解压代价。
 */
export async function extractCoverFromZip(
  zip: JSZip,
  book: FoliateBook
): Promise<CoverImage | undefined> {
  const coverHref = book.resources?.cover?.href;
  if (!coverHref) return undefined;
  const entry = zip.file(coverHref);
  if (!entry || entry.dir) return undefined;
  const bytes = await entry.async('uint8array');
  const dot = coverHref.lastIndexOf('.');
  const ext = dot === -1 ? '' : coverHref.slice(dot).toLowerCase();
  return { bytes, ext };
}
