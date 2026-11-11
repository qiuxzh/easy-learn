import { memo, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { hidePdfMeasuringCanvases } from './pdf-document';

export interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** 首页尺寸，用于第一帧先撑出正确大小的白纸，真实尺寸渲染后校正。 */
  baseSize: { width: number; height: number };
}

/**
 * 单页渲染单元：canvas 位图 + 可选文字层。
 *
 * 滚动与翻页两种容器共用这一个组件，切换模式只换容器、不重建文档。
 * 文字层只提供浏览器原生的选中与复制，不向对话暴露任何状态。
 * 纸张恒为白底：它是内容色而不是主题色，不随暗色模式翻转。
 */
export const PdfPage = memo(function PdfPage({ pdf, pageNumber, scale, baseSize }: PdfPageProps) {
  const [size, setSize] = useState({
    width: baseSize.width * scale,
    height: baseSize.height * scale,
  });
  const canvasHost = useRef<HTMLDivElement>(null);
  const textLayerHost = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  /** 渲染序列号：快速缩放或翻页时丢掉过期结果。 */
  const sequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const current = ++sequence.current;

    const renderPage = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      pageRef.current = page;

      // 每页都用自己的 viewport：PDF 允许横竖混排，复用首页尺寸会拉伸画布、
      // 让文字层与位图错位，选区会偏。
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
      if (cancelled) return;

      // 位图按 DPR 加密，但 canvas 的布局尺寸必须留在 zoom 空间——
      // 文字层的盒子与它同处这个空间，否则超出的 span 会被裁掉，选区短一截。
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = 'block';

      await page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      }).promise;

      if (cancelled || sequence.current !== current) return;
      canvasHost.current?.replaceChildren(canvas);

      const container = textLayerHost.current;
      if (!container) return;
      container.replaceChildren();
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      await layer.render();
      if (cancelled || sequence.current !== current) return;
      hidePdfMeasuringCanvases();
    };

    void renderPage().catch(error => {
      if (!cancelled) console.warn('[pdf-viewer] render page failed:', pageNumber, error);
    });

    return () => {
      cancelled = true;
      sequence.current += 1;
      pageRef.current?.cleanup();
      pageRef.current = null;
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div
      className="relative shrink-0 shadow-[0_1px_3px_rgba(15,17,21,.14),0_8px_24px_rgba(15,17,21,.07)]"
      style={{ width: size.width, height: size.height, backgroundColor: '#fff' }}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      <div ref={textLayerHost} className="textLayer" />
    </div>
  );
});
