import { Fragment, memo, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PdfToc, PdfTocItem } from '@shared/types/library';

interface PdfOutlineProps {
  toc: PdfToc | null;
  currentPage: number;
  pageCount: number;
  onJump: (page: number) => void;
  onClose: () => void;
}

/** 找到「页号不超过当前页」的最深目录项，用于当前位置高亮。 */
function findActiveKey(
  items: readonly PdfTocItem[],
  currentPage: number,
  prefix = ''
): string | null {
  let best: string | null = null;
  items.forEach((item, index) => {
    const key = `${prefix}${index}`;
    if (item.page !== null && item.page <= currentPage) best = key;
    if (item.items?.length) {
      const nested = findActiveKey(item.items, currentPage, `${key}.`);
      if (nested) best = nested;
    }
  });
  return best;
}

/**
 * PDF viewer 自己的目录面板。
 *
 * 只在正文左侧并排出现，不做悬浮、不做二级形态选择。
 * 数据只来自导入时写下的 docMeta：前端不解析、不回退，null 就是没有目录数据。
 */
export const PdfOutline = memo(function PdfOutline({
  toc,
  currentPage,
  pageCount,
  onJump,
  onClose,
}: PdfOutlineProps) {
  const [jumpValue, setJumpValue] = useState('');
  const activeKey = toc ? findActiveKey(toc.items, currentPage) : null;

  const renderItems = (items: readonly PdfTocItem[], depth: number, prefix: string): ReactNode =>
    items.map((item, index) => {
      const key = `${prefix}${index}`;
      return (
        <Fragment key={key}>
          <button
            type="button"
            title={item.title}
            disabled={item.page === null}
            className={cn(
              'flex h-7 w-full items-center gap-1 rounded-md pr-1.5 text-left text-xs hover:bg-secondary disabled:cursor-default',
              activeKey === key && 'bg-secondary font-medium'
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => {
              if (item.page !== null) onJump(item.page);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.page !== null && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {item.pageLabel ?? item.page}
              </span>
            )}
          </button>
          {item.items?.length ? renderItems(item.items, depth + 1, `${key}.`) : null}
        </Fragment>
      );
    });

  const submitJump = (event: FormEvent): void => {
    event.preventDefault();
    const target = Number.parseInt(jumpValue, 10);
    if (Number.isFinite(target) && target > 0) {
      onJump(Math.min(pageCount || target, Math.floor(target)));
      setJumpValue('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-stroke-3 px-2.5 text-sm font-medium">
        <span>目录</span>
        <button
          type="button"
          title="关闭目录"
          aria-label="关闭目录"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        {!toc || toc.items.length === 0 ? (
          <div className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
            该资料没有内置目录
          </div>
        ) : (
          renderItems(toc.items, 0, '')
        )}
      </div>

      <form
        onSubmit={submitJump}
        className="flex h-9 shrink-0 items-center gap-1 border-t border-stroke-3 px-2.5 text-xs text-muted-foreground"
      >
        <span className="shrink-0">跳至</span>
        <input
          value={jumpValue}
          onChange={event => setJumpValue(event.target.value)}
          inputMode="numeric"
          aria-label="跳转页码"
          className="h-6 w-12 rounded border border-stroke-3 bg-background px-1.5 text-center text-xs text-foreground outline-none focus:border-primary"
        />
        <span className="shrink-0">/ {pageCount} 页</span>
      </form>
    </div>
  );
});
