import { toast } from 'sonner';
import { useCallback, useMemo, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Pencil,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCardEditDialog } from '@/hooks/use-card-edit-dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  ACTION_META,
  buildDetail,
  FlashcardChangeBody,
  isFlashcardWriteTool,
  parseFlashcardChange,
} from '@/components/chat/tools/FlashcardChangeView';
import type { AppUIMessage } from '@/types/message';
import type { FlashcardChangeDetail } from '@shared/types/flashcards';

/**
 * trace 底部的闪卡改动汇总：把本轮所有成功的写入操作聚成一份清单。
 * 整块是一张卡片——头部是汇总，下面是明细；每条明细可折叠，折叠态高度一致。
 */

/** 每种操作的图标底色，沿用项目里 emerald/sky/red 的既有配色习惯。 */
const ACTION_CHIP_CLASS: Record<FlashcardChangeDetail['action'], string> = {
  create: 'bg-success-surface text-success-ink',
  update: 'bg-info-surface text-info-ink',
  delete: 'bg-danger-surface text-danger-ink',
};

/** 收起状态下最多直接列出的条目数；多出来的折进底部“显示全部”。 */
const COLLAPSED_VISIBLE_COUNT = 10;

/** 从 trace 内的助手消息里收集本轮成功的闪卡写入操作，按发生顺序排列。 */
export function collectFlashcardChanges(messages: AppUIMessage[]): FlashcardChangeDetail[] {
  const changes: FlashcardChangeDetail[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      // 只统计成功的结果：失败的工具调用没有详情，也不该出现在改动清单里
      if (part.type !== 'tool-result' || !part.success) continue;
      if (!isFlashcardWriteTool(part.toolName)) continue;
      const change = parseFlashcardChange(part.details);
      if (change) changes.push(change);
    }
  }
  return changes;
}

/** 头部汇总文案：只列出数量不为零的改动类型。 */
export function buildSummary(changes: FlashcardChangeDetail[]): string {
  const counts = { create: 0, update: 0, delete: 0 };
  for (const change of changes) {
    counts[change.action] += 1;
  }

  const parts: string[] = [];
  if (counts.create > 0) parts.push(`已添加${counts.create}个闪卡`);
  if (counts.update > 0) parts.push(`已修改${counts.update}个闪卡`);
  if (counts.delete > 0) parts.push(`已删除${counts.delete}个闪卡`);
  return parts.join('，');
}

/**
 * 单条改动：折叠时是一行等高的摘要，展开后显示完整内容。
 * 整行负责展开/收起（列表的常规习惯，点击区域也大）；
 * 编辑是独立的小按钮，不占用行点击，避免"想展开却弹出弹窗"。
 */
function FlashcardChangeItem({
  change,
  open,
  onOpenChange,
  onEdit,
}: {
  change: FlashcardChangeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑回调；删除的记录卡片已不存在，因此不传。 */
  onEdit?: () => void;
}) {
  const { label, Icon } = ACTION_META[change.action];

  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      {/* 展开触发器与编辑按钮是同级按钮：避免按钮嵌套，也无需阻断冒泡 */}
      <div className="flex items-center transition-colors hover:bg-surface-2">
        <Collapsible.Trigger
          className={cn(
            'group flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 text-left'
          )}
          aria-label={open ? '收起详情' : '展开详情'}
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-sm',
              ACTION_CHIP_CLASS[change.action]
            )}
          >
            <Icon className="size-4" />
          </span>
          <span className="shrink-0 text-body font-medium text-ink-secondary">{label}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
            {buildDetail(change)}
          </span>
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-ink-tertiary transition-transform duration-150 ease-out',
              'rotate-0 group-data-panel-open:rotate-90'
            )}
          />
        </Collapsible.Trigger>
        {onEdit && (
          <IconButton
            type="button"
            variant="quiet"
            label="编辑卡片"
            className="mr-2"
            onClick={onEdit}
          >
            <Pencil />
          </IconButton>
        )}
      </div>
      <Collapsible.Panel
        className={cn(
          'overflow-hidden bg-surface-1',
          'h-[var(--collapsible-panel-height)] transition-[height] duration-150 ease-out',
          'data-ending-style:h-0 data-starting-style:h-0',
          "[&[hidden]:not([hidden='until-found'])]:hidden"
        )}
      >
        <div className="mx-3 mb-2 overflow-hidden rounded-md border border-stroke-3 bg-background">
          <FlashcardChangeBody change={change} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/**
 * 本轮闪卡改动汇总。没有改动时整块不渲染。
 * 由调用方保证只在该 trace 结束后渲染——运行中还会继续产生改动，提前展示会误导。
 * 明细一律默认折叠：只给一行汇总，用户点开哪条才看哪条的内容；
 * 条目超过 COLLAPSED_VISIBLE_COUNT 时先只列前几条，其余折进底部的“显示全部”。
 */
export function FlashcardChangesBlock({ messages }: { messages: AppUIMessage[] }) {
  const changes = useMemo(() => collectFlashcardChanges(messages), [messages]);
  /** 用户手动展开的条目；初始为空集，也就是全部折叠。 */
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  /** 是否放开被折叠的其余条目。 */
  const [showAllItems, setShowAllItems] = useState(false);
  // 编辑弹窗由本组件持有：弹窗只被这一处触发，无需引入全局状态或上下文
  const { openEditCard, cardEditDialog } = useCardEditDialog();

  /**
   * 打开编辑弹窗。先拉实时卡片而不是直接用快照：
   * 快照是当时的记录，卡片可能已被删除或已被用户改过，用实时数据才不会覆盖新改动。
   */
  const handleEdit = useCallback(
    async (change: FlashcardChangeDetail) => {
      const result = await window.api.getCard({ id: change.card.id });
      if (!result.success || !result.card) {
        toast.error(result.error ?? '卡片已不存在');
        return;
      }
      openEditCard(result.card);
    },
    [openEditCard]
  );

  // 条目身份用卡片 id + 序号：同一张卡片一轮里可能被改动多次
  const items = changes.map((change, index) => ({
    change,
    key: `${change.card.id}-${index}`,
  }));
  const hasOverflow = items.length > COLLAPSED_VISIBLE_COUNT;
  const visibleItems = showAllItems ? items : items.slice(0, COLLAPSED_VISIBLE_COUNT);

  if (changes.length === 0) return null;

  /** 某条目当前是否展开。 */
  const isOpen = (key: string) => openKeys.has(key);
  const allOpen = items.every(item => isOpen(item.key));

  /** 展开/收起单条。 */
  const toggleItem = (key: string, open: boolean) => {
    const next = new Set(openKeys);
    if (open) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setOpenKeys(next);
  };

  /** 一键展开/收起全部条目（含被“显示全部”折起来的部分）。 */
  const toggleAll = () => {
    setOpenKeys(allOpen ? new Set() : new Set(items.map(item => item.key)));
  };

  return (
    <div className="w-full overflow-hidden rounded-lg border border-stroke-3 bg-surface-1">
      <div className="flex items-center gap-2 border-b border-stroke-3 bg-surface-2 px-3 py-2">
        <WalletCards className="size-4 shrink-0 text-ink-tertiary" />
        <span className="text-body font-medium text-ink-secondary">{buildSummary(changes)}</span>
        <IconButton
          type="button"
          variant="quiet"
          label={allOpen ? '收起全部' : '展开全部'}
          className="ml-auto"
          onClick={toggleAll}
        >
          {allOpen ? <ChevronsUp /> : <ChevronsDown />}
        </IconButton>
      </div>
      <div className="flex flex-col divide-y divide-ink-caption">
        {visibleItems.map(({ change, key }) => (
          <FlashcardChangeItem
            key={key}
            change={change}
            open={isOpen(key)}
            onOpenChange={open => toggleItem(key, open)}
            // 删除的记录卡片已不存在，不提供编辑入口
            onEdit={change.action === 'delete' ? undefined : () => void handleEdit(change)}
          />
        ))}
      </div>
      {hasOverflow && (
        <div className="flex justify-center border-t border-stroke-3 py-1">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => setShowAllItems(prev => !prev)}
          >
            {showAllItems ? <ChevronUp /> : <ChevronDown />}
            {showAllItems ? '收起' : `显示全部 ${items.length} 条`}
          </Button>
        </div>
      )}
      {cardEditDialog}
    </div>
  );
}
