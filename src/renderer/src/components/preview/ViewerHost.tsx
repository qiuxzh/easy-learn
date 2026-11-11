import { memo, type ReactElement } from 'react';
import { FileQuestion } from 'lucide-react';
import type { ResourceDetailDTO } from '@shared/types/library';
import { PdfViewer } from './viewers/pdf/PdfViewer';

/**
 * 预览页的内容分发器。
 *
 * 只按 `resource.format` 选 viewer，不解释 viewer 的任何状态与数据结构：
 * 目录、翻页模式、缩放、文本层都归 viewer 自己管理。
 */
export const ViewerHost = memo(function ViewerHost({
  detail,
}: {
  detail: ResourceDetailDTO;
}): ReactElement {
  const { resource } = detail;
  if (resource.kind !== 'file' || resource.format !== 'pdf') {
    return <UnsupportedPreview />;
  }
  return <PdfViewer detail={detail} />;
});

/** 首版只做 PDF；其它格式给一个明确的空态，不假装支持。 */
function UnsupportedPreview(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <FileQuestion className="h-8 w-8 opacity-40" />
      <span>暂不支持预览的格式</span>
    </div>
  );
}
