import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { Menu, MessageSquare, Loader2 } from 'lucide-react';
import { Chat } from '@/pages/Chat';
import { Button } from '@/components/ui/button';
import { useReaderStore } from '@/stores/reader-store';
import { TOCPanel } from './TOCPanel';
import { BookViewer } from './BookViewer';
import { ReaderStatusBar } from './ReaderStatusBar';
import { cn } from '@/lib/utils';

/** 侧面板打开时占容器宽度的比例 */
const TOC_OPEN_RATIO = 0.18;
const CHAT_OPEN_RATIO = 0.4;
const MIN_CONTENT_PX = 200;

interface ReaderViewProps {
  tabId?: string;
  bookId?: string;
}

export function ReaderView({ tabId: propTabId, bookId = '' }: ReaderViewProps) {
  const tabId = propTabId ?? '';
  const isReady = useReaderStore(s => s.tabs[tabId]?.isReady ?? false);
  const initReaderTab = useReaderStore(s => s.initReaderTab);
  const deleteReaderTab = useReaderStore(s => s.deleteReaderTab);

  const [tocOpen, setTocOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const tocOpenRef = useRef(false);
  const chatOpenRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useGroupRef();
  const containerWidthRef = useRef(0);
  const currentLayoutRef = useRef({ toc: 0, content: 100, chat: 0 });

  // 监听容器宽度变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      containerWidthRef.current = entries[0].contentRect.width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 跟踪当前布局
  const handleLayoutChanged = useCallback((layout: Record<string, number>) => {
    currentLayoutRef.current = layout as { toc: number; content: number; chat: number };
  }, []);

  // 切换面板：打开时设为目标宽度，关闭时设为 0，另一个面板的像素宽度不变
  const togglePanel = useCallback(
    (panel: 'toc' | 'chat') => {
      const width = containerWidthRef.current;
      if (width === 0) return;

      const { toc: tocPct, chat: chatPct } = currentLayoutRef.current;
      const isToc = panel === 'toc';
      const next = isToc ? !tocOpenRef.current : !chatOpenRef.current;

      // 更新 state 和 ref
      if (isToc) {
        tocOpenRef.current = next;
        setTocOpen(next);
      } else {
        chatOpenRef.current = next;
        setChatOpen(next);
      }

      // 打开/关闭对应的侧面板，另一个面板的像素宽度不变
      const targetTocPx = isToc ? (next ? width * TOC_OPEN_RATIO : 0) : (tocPct / 100) * width;
      const targetChatPx = isToc ? (chatPct / 100) * width : next ? width * CHAT_OPEN_RATIO : 0;
      const targetContentPx = Math.max(width - targetTocPx - targetChatPx, MIN_CONTENT_PX);

      groupRef.current?.setLayout({
        toc: (targetTocPx / width) * 100,
        content: (targetContentPx / width) * 100,
        chat: (targetChatPx / width) * 100,
      });
    },
    [groupRef]
  );

  // mount / unmount
  useEffect(() => {
    if (!tabId || !bookId) return;
    initReaderTab(tabId, bookId);
    return () => deleteReaderTab(tabId);
  }, [tabId, bookId, initReaderTab, deleteReaderTab]);

  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        未指定书籍
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <Group
        groupRef={groupRef}
        onLayoutChanged={handleLayoutChanged}
        defaultLayout={{ toc: 0, content: 100, chat: 0 }}
      >
        <Panel id="toc" minSize={0} defaultSize={0} maxSize="25%">
          <div className="h-full border-r border-border">
            <TOCPanel readerTabId={tabId} className="h-full" />
          </div>
        </Panel>

        <Separator
          className="w-1.5 cursor-col-resize bg-transparent transition-colors data-[separator=hover]:bg-border data-[separator=active]:bg-border shrink-0"
          disableDoubleClick
        />

        <Panel id="content" minSize="30%">
          <div className="h-full flex flex-col">
            {/* 工具栏：只放面板开关，翻页控件在底部状态栏 */}
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label={tocOpen ? '隐藏目录' : '显示目录'}
                onClick={() => togglePanel('toc')}
                className={cn(tocOpen && 'bg-accent text-accent-foreground')}
              >
                <Menu className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                aria-label={chatOpen ? '隐藏对话' : '显示对话'}
                onClick={() => togglePanel('chat')}
                className={cn(chatOpen && 'bg-accent text-accent-foreground')}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
            {/* 内容区域 */}
            <div className="flex-1 min-h-0">
              <BookViewer readerTabId={tabId} />
            </div>
            {/* 底部状态栏 */}
            <ReaderStatusBar readerTabId={tabId} />
          </div>
        </Panel>

        <Separator
          className="w-1.5 cursor-col-resize bg-transparent transition-colors data-[separator=hover]:bg-border data-[separator=active]:bg-border shrink-0"
          disableDoubleClick
        />

        <Panel id="chat" minSize={0} defaultSize={0} maxSize="50%">
          <div className="h-full border-l border-border">
            <Chat bookId={bookId} />
          </div>
        </Panel>
      </Group>

      {!isReady && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载书籍...
          </div>
        </div>
      )}
    </div>
  );
}
