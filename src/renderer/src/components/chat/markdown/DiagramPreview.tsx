import { useState, type ReactNode } from 'react';
import { PreviewDialog } from '@/components/chat/PreviewDialog';
import { ZoomablePreviewArea } from '@/components/chat/markdown/ZoomablePreviewArea';

/** 图表预览属性。 */
type DiagramPreviewProps = {
  children: ReactNode;
  contentWidth?: number;
  contentHeight?: number;
  /** 全屏预览的读屏标题 */
  label: string;
};

/**
 * 图表预览：内联画布与全屏浮层共用同一个缩放引擎和同一份内容。
 *
 * 两处内容来自同一份节点，主题切换导致 Mermaid 重新渲染时，内联与全屏会一起更新。
 * 全屏与图片查看器共用深色外壳：内容居中留白，图表保留主题底色，关闭键放在工具条里。
 */
export function DiagramPreview({
  children,
  contentWidth,
  contentHeight,
  label,
}: DiagramPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <ZoomablePreviewArea
        contentWidth={contentWidth}
        contentHeight={contentHeight}
        onExpand={() => setIsExpanded(true)}
      >
        {children}
      </ZoomablePreviewArea>
      <PreviewDialog open={isExpanded} onOpenChange={setIsExpanded} title={label}>
        <ZoomablePreviewArea
          fill
          transparent
          contentBackground="theme"
          inset={48}
          wheelZoom="always"
          contentWidth={contentWidth}
          contentHeight={contentHeight}
          onClose={() => setIsExpanded(false)}
          dismissOnBackdrop
        >
          {children}
        </ZoomablePreviewArea>
      </PreviewDialog>
    </>
  );
}
