import { memo, useEffect, useState, type FormEvent } from 'react';
import { List, Minus, MoveHorizontal, MoveVertical, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';

export type PdfViewMode = 'scroll' | 'page';

interface PdfToolbarProps {
  tocOpen: boolean;
  onToggleToc: () => void;
  mode: PdfViewMode;
  onModeChange: (mode: PdfViewMode) => void;
  currentPage: number;
  pageCount: number;
  onJump: (page: number) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onFitWidth: () => void;
  onFitHeight: () => void;
}

const SEP = <span className="mx-1 h-4 w-px shrink-0 bg-stroke-3" />;

const MODE_OPTIONS: ReadonlyArray<{ value: PdfViewMode; label: string }> = [
  { value: 'scroll', label: '滚动' },
  { value: 'page', label: '翻页' },
];

/**
 * 40px 工具行，完全由 PDF viewer 自己渲染；app 层只留了这 40px 槽位。
 *
 * 目录是一枚纯开关：点一下就开，再点一下关。
 * 之前那版要先点按钮、再在下拉里选「固定 / 悬浮 / 关闭」，多一步且要反复确认点对了没。
 */
export const PdfToolbar = memo(function PdfToolbar({
  tocOpen,
  onToggleToc,
  mode,
  onModeChange,
  currentPage,
  pageCount,
  onJump,
  scale,
  onScaleChange,
  onFitWidth,
  onFitHeight,
}: PdfToolbarProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const commitPage = (event?: FormEvent): void => {
    event?.preventDefault();
    const target = Number.parseInt(pageInput, 10);
    if (Number.isFinite(target) && target > 0) {
      onJump(Math.min(Math.max(pageCount, 1), Math.floor(target)));
    } else {
      setPageInput(String(currentPage));
    }
  };

  return (
    <div className="relative z-10 flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b border-stroke-3 bg-background px-2">
      <IconButton label={tocOpen ? '关闭目录' : '打开目录'} pressed={tocOpen} onClick={onToggleToc}>
        <List />
      </IconButton>

      {SEP}

      <SegmentedToggle value={mode} options={MODE_OPTIONS} onChange={onModeChange} />

      {SEP}

      <form
        onSubmit={commitPage}
        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
      >
        <Input
          value={pageInput}
          onChange={event => setPageInput(event.target.value)}
          onBlur={() => commitPage()}
          inputMode="numeric"
          aria-label="当前页码"
          className="h-6 w-10 px-1 text-center text-xs tabular-nums"
        />
        <span className="tabular-nums">/ {pageCount}</span>
      </form>

      <span className="min-w-2 flex-1" />

      <IconButton label="缩小" size="xs" onClick={() => onScaleChange(scale - 0.1)}>
        <Minus />
      </IconButton>
      <span className="w-11 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {Math.round(scale * 100)}%
      </span>
      <IconButton label="放大" size="xs" onClick={() => onScaleChange(scale + 0.1)}>
        <Plus />
      </IconButton>

      {SEP}

      {/* 中区被对话栏挤窄时只留图标：两个文字按钮并排要 128px，图标版只要 60px */}
      <Button variant="ghost" size="xs" title="适应宽度" onClick={onFitWidth}>
        <MoveHorizontal />
        <span className="hidden xl:inline">适应宽度</span>
      </Button>
      <Button variant="ghost" size="xs" title="适应高度" onClick={onFitHeight}>
        <MoveVertical />
        <span className="hidden xl:inline">适应高度</span>
      </Button>
    </div>
  );
});
