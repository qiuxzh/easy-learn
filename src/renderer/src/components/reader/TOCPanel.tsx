import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { TOCItem } from '@shared/types/books';
import { useReaderStore } from '@/stores/reader-store';

interface TOCPanelProps {
  readerTabId: string;
  className?: string;
}

/**
 * 单条目录节点：
 * - 叶子节点：单行展示，点击跳转到对应章节
 * - 父节点：用本地 state 控制展开/折叠，点击自身跳转（有 href 时）
 */
function TOCNode({ node, readerTabId }: { node: TOCItem; readerTabId: string }) {
  const [open, setOpen] = useState(node.level < 2);
  const hasChildren = !!node.subitems?.length;

  // 不同层级使用不同粗细和颜色
  const levelStyles = {
    0: 'font-semibold text-foreground',
    1: 'font-medium text-foreground/90',
    2: 'text-foreground/80',
  }[Math.min(node.level, 2)];

  const indent = `${12 + node.level * 16}px`;

  /** 点击跳转到章节 */
  const handleNavigate = () => {
    if (!node.href) return;
    useReaderStore.getState().navigateToPos(readerTabId, node.href);
  };

  if (!hasChildren) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') handleNavigate();
        }}
        className={cn(
          'flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground cursor-pointer',
          levelStyles
        )}
        style={{ paddingLeft: indent }}
        title={node.title || '未命名章节'}
      >
        <span className="min-w-0 flex-1 truncate">{node.title || '未命名章节'}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // 点击箭头区域只展开/折叠
          setOpen(v => !v);
          // 如果有 href，整体点击也跳转
          if (node.href) handleNavigate();
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          levelStyles
        )}
        style={{ paddingLeft: indent }}
        title={node.title || '未命名章节'}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="min-w-0 flex-1 truncate">{node.title || '未命名章节'}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/50 pl-1">
          {node.subitems?.map(child => (
            <TOCNode key={child.id} node={child} readerTabId={readerTabId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TOCPanel({ readerTabId, className }: TOCPanelProps) {
  const tocs = useReaderStore(s => s.tabs[readerTabId]?.book?.tocs);

  const list = useMemo(() => tocs ?? [], [tocs]);

  return (
    <div className={cn('flex h-full flex-col border-r border-border bg-background', className)}>
      <div className="shrink-0 px-3 py-2 text-sm font-semibold text-muted-foreground">目录</div>
      <ScrollArea className="scroll-area-fit min-w-0 flex-1">
        <div className="space-y-0.5 p-2">
          {list.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">暂无目录</div>
          ) : (
            list.map(node => <TOCNode key={node.id} node={node} readerTabId={readerTabId} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
