import { mkdir, rm } from 'fs/promises';
import path from 'path';
import { ocrPage, type OcrPage } from './ocr';

/** 页面图的落盘目录名，位于工作目录之下 */
const PAGE_IMAGE_DIR = 'pages';

/** 一页的页面图：阶段 1 的产物 */
export interface EtlPageImage {
  /** 页码，从 1 开始 */
  page: number;
  /** 页面图的落盘路径 */
  filePath: string;
}

/**
 * 一次运行的记录。只记结果，不做断点续跑
 *
 * TODO 断点续跑、进度回报、失败页清单，等接 UI 时再加
 */
export interface EtlRunRecord {
  /** 源文件路径 */
  filePath: string;
  /** 源文件页数 */
  pageCount: number;
  /** 每页的识别结果，按页序排列 */
  ocrPages: OcrPage[];
}

/** 阶段 1：把源文件拆成页面图 */
export type PdfToImages = (filePath: string, workDir: string) => Promise<EtlPageImage[]>;

/** runEtl 的运行参数 */
export interface EtlRunOptions {
  /** 源文件路径 */
  filePath: string;
  /** PaddleOCR 访问令牌 */
  token: string;
  /** 中间产物的落盘目录，由调用方决定 */
  workDir: string;
  /** 阶段 1 的实现 */
  pdfToImages: PdfToImages;
  /** 每页识别完成后的回调，用于输出进度 */
  onPage?: (page: number, total: number) => void;
}

/**
 * 编排一次提取运行：源文件 → 页面图 → 每页的识别结果
 *
 * 令牌与工作目录都由调用方传入，本文件不读配置、不依赖 Electron
 * 页面图是阶段 2 的输入，OCR 结束后即删除——中间产物不留在工作目录里
 * TODO 失败的页会连同已完成的页一起被删掉，重跑代价大，等加续跑时再处理
 */
export async function runEtl(options: EtlRunOptions): Promise<EtlRunRecord> {
  const { filePath, token, workDir, pdfToImages, onPage } = options;
  const pageDir = path.join(workDir, PAGE_IMAGE_DIR);

  // 每次运行都从干净的目录开始，避免上一次的残留被当成输入
  await rm(pageDir, { recursive: true, force: true });
  await mkdir(pageDir, { recursive: true });

  const pages = await pdfToImages(filePath, workDir);
  const ocrPages: OcrPage[] = [];

  try {
    for (const page of pages) {
      ocrPages.push(await ocrPage(page.filePath, token));
      onPage?.(ocrPages.length, pages.length);
    }
  } finally {
    await rm(pageDir, { recursive: true, force: true });
  }

  return { filePath, pageCount: pages.length, ocrPages };
}
