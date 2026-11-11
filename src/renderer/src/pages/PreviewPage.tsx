import { memo, useEffect, useState, type ReactElement } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { ViewerHost } from '@/components/preview/ViewerHost';
import { PreviewSideChat } from '@/components/preview/PreviewSideChat';
import { usePanelWidth } from '@/hooks/use-panel-width';
import type { ResourceDetailDTO } from '@shared/types/library';

/** 一个 Tab 对应一份资料；resourceId 由 TabContent 从 tab.params 透传。 */
export interface PreviewPageProps {
  resourceId?: string;
}

/** 对话栏宽度区间：再窄放不下输入框，再宽会把正文挤到没法读 */
const CHAT_PANE = { defaultWidth: 420, min: 320, max: 640 };

/**
 * 资料预览工作区：中区（viewer）＋ 右侧对话栏。
 *
 * 只有两栏。资料库不在这里——它已经是独立的 Tab，再放一份进来只是冗余。
 * viewer 的目录、工具行、翻页模式都归 viewer 自己管。
 * 对话只有「停靠右侧 / 收起」两态，收起后中区右下角浮出一枚「对话」按钮把它拉回来。
 */
export const PreviewPage = memo(function PreviewPage({
  resourceId,
}: PreviewPageProps): ReactElement {
  const [detail, setDetail] = useState<ResourceDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);

  const chatWidth = usePanelWidth({
    ...CHAT_PANE,
    storageKey: 'preview-chat-width',
    edge: 'end',
  });

  useEffect(() => {
    if (!resourceId) {
      setDetail(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setError(null);
    window.api.library
      .getResource(resourceId)
      .then(value => {
        if (!cancelled) setDetail(value);
      })
      .catch(reason => {
        if (!cancelled) setError(String(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  const pageCount = detail?.docMeta?.format === 'pdf' ? detail.docMeta.pageCount : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              无法打开这份资料：{error}
            </div>
          ) : detail ? (
            <ViewerHost detail={detail} />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在打开资料…
            </div>
          )}

          {/* 收起后的唯一入口：贴在中区右下角，躲开翻页模式的左右箭头和底部页码 */}
          {!chatOpen && (
            <button
              type="button"
              title="打开对话"
              onClick={() => setChatOpen(true)}
              className={cn(
                'absolute bottom-14 right-3 z-20 flex h-8 items-center gap-1.5 rounded-full',
                'border border-stroke-3 bg-background/95 px-3 text-xs font-medium text-foreground',
                'shadow-md backdrop-blur transition-colors hover:bg-secondary'
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              对话
            </button>
          )}
        </main>

        {chatOpen && (
          <>
            <ResizeHandle label="调整对话宽度" onResize={chatWidth.resize} />
            <aside
              style={{ width: chatWidth.width }}
              className="flex min-h-0 shrink-0 flex-col bg-background"
            >
              <PreviewSideChat onClose={() => setChatOpen(false)} />
            </aside>
          </>
        )}
      </div>

      {/* 状态栏只显示资料信息；模式、缩放、页码都在 viewer 自己的工具行里 */}
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-stroke-3 bg-secondary px-2.5 text-[11px] text-muted-foreground">
        <span className="max-w-[40%] truncate">{detail?.resource.name ?? '资料预览'}</span>
        {detail && (
          <span>
            {detail.resource.format?.toUpperCase() ?? '文件'}
            {pageCount !== null ? ` · ${pageCount} 页` : ''}
          </span>
        )}
      </div>
    </div>
  );
});
