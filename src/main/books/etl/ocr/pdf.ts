import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFiumLibrary, type PDFiumPageRenderOptions } from '@hyzyla/pdfium';
import type { EtlPageImage } from './etl-work';

/**
 * 渲染精度：200 DPI。该精度下正文、公式与图表都能辨认
 *
 * PDFium 以 72 DPI 为基准，故 scale 直接用这个比值
 */
const RENDER_DPI = 200;
const PDF_BASE_DPI = 72;
const RENDER_SCALE = RENDER_DPI / PDF_BASE_DPI;

/**
 * 整个文档共用一个 PDFium 实例，初始化有固定开销，不要每页重建
 *
 * 实例常驻不释放：PDFium 的 WASM 堆无法可靠回收，重复 init/destroy 会持续增长。
 * 文档本身在渲染结束后立即释放，占用大头是文档而非库
 */
let libraryPromise: Promise<PDFiumLibrary> | null = null;

/** 页面图的落盘目录名，位于工作目录之下 */
const PAGE_IMAGE_DIR = 'pages';

/** 文件名形如 page_0001.png，固定 4 位序号保证字典序等于页序 */
const PAGE_FILE_PREFIX = 'page_';
const PAGE_FILE_DIGITS = 4;
const PAGE_FILE_EXT = 'png';

/**
 * 页面图的文件名。序号补零，使 ocrPages 按文件名排序时页序正确
 */
function pageFileName(page: number): string {
  return `${PAGE_FILE_PREFIX}${String(page).padStart(PAGE_FILE_DIGITS, '0')}.${PAGE_FILE_EXT}`;
}

/**
 * 取全局的 PDFium 实例，首次调用时初始化
 */
function getLibrary(): Promise<PDFiumLibrary> {
  libraryPromise ??= PDFiumLibrary.init();
  return libraryPromise;
}

/**
 * 把 PDFium 交出的位图编码成 PNG
 *
 * 回调应尽量短：PDFium 在此期间持有该页的像素，编码放在这里可以避免整页
 * 位图在 JS 侧多留一份
 */
function encodePng(options: PDFiumPageRenderOptions): Promise<Uint8Array> {
  const { width, height, data } = options;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(width, height);
  const target = imageData.data;

  // PDFium 按 BGRA 排列，canvas 需要 RGBA；alpha 一律置为不透明，
  // 页面图不需要透明通道，不透明也能让 OCR 拿到干净的白底
  for (let index = 0; index < data.length; index += 4) {
    target[index] = data[index + 2];
    target[index + 1] = data[index + 1];
    target[index + 2] = data[index];
    target[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return Promise.resolve(canvas.toBuffer('image/png'));
}

/**
 * 用 PDFium 把 PDF 逐页渲染成页面图并落盘
 *
 * 选型说明：pdfjs 在 Node 下渲染大尺寸扫描图很慢——它会把解码后的原始像素
 * 重新写回 canvas 并做多级重采样，实测约 9.4s/页，且耗时与输出分辨率无关。
 * PDFium 是 Chrome 使用的 PDF 引擎，同样精度下约 0.8s/页
 *
 * 逐页渲染，同一时刻只持有当前页的位图，避免整本书的像素常驻内存
 */
export async function pdfToImages(filePath: string, workDir: string): Promise<EtlPageImage[]> {
  const dir = path.join(workDir, PAGE_IMAGE_DIR);
  await mkdir(dir, { recursive: true });

  const library = await getLibrary();
  const document = await library.loadDocument(await readFile(filePath));

  const pages: EtlPageImage[] = [];
  try {
    for (const [index, page] of [...document.pages()].entries()) {
      const number = index + 1;
      // 回调返回的字节即 PNG 内容
      const image = await page.render({ scale: RENDER_SCALE, render: encodePng });

      const target = path.join(dir, pageFileName(number));
      await writeFile(target, Buffer.from(image.data));
      pages.push({ page: number, filePath: target });
    }
  } finally {
    document.destroy();
  }

  return pages;
}
