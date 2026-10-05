import type { FoliateBook } from '@/components/reader/foliate-types';
import type { TOCItem, CoverImage } from '@shared/types/books';

/**
 * foliate-js 给 EPUB loader 提供的接口。
 * 主进程（jsdom）和渲染进程（浏览器）共用，由 makeZipLoader 实现。
 */
export interface FoliateLoader {
  loadText: (name: string) => Promise<string | null>;
  loadBlob: (name: string, type?: string) => Promise<Blob | null>;
  /** 各 section 未压缩字节数，foliate-js SectionProgress 算总进度依赖此值 */
  getSize: (name: string) => number;
}

export interface ParseEpubOptions {
  /**
   * 是否在 loadBlob 中把数据复制到独立 ArrayBuffer。
   * 主进程 jsdom Blob 与 SharedArrayBuffer 不兼容，需要 true；浏览器可保持 false 节省一次拷贝。
   */
  copyBlob?: boolean;
}

/**
 * 接受 ArrayBuffer（浏览器 fetch 返回）或 Uint8Array（Node Buffer 是其子类，主进程 fs.readFile 返回）。
 */
export type EpubBufferInput = ArrayBuffer | Uint8Array;

/** parseEpubFromBuffer / parseEpubFromZip 的返回结果 */
export interface ParsedEpub {
  /** foliate-js 解析出的原始对象，BookViewer 渲染时使用 */
  rawBook: FoliateBook;
  /** 扁平化后的目录树，TOC 面板直接渲染 */
  tocs: TOCItem[];
  metadata: {
    title: string;
    author?: string;
    /** 仅在调用方显式 extractCover 时填充；parseEpub 默认不提取（避免不必要的开销） */
    cover?: CoverImage;
    /** 章节总数 */
    totalChapters: number;
  };
}
