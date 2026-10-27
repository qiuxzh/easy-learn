import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  GalleryHorizontalEnd,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCardEditDialog } from '@/hooks/use-card-edit-dialog';
import { useTabsStore } from '@/stores/tabs-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CardGroupSummary } from '@shared/types/flashcards';

/** 每张卡的预估学习时长（秒）。只用于今日带的「约 N 分钟」，不参与调度。 */
const SECONDS_PER_CARD = 20;

/** 今日带的容器样式。三种状态共用，避免切换时高度跳动。 */
const BAND_CLASS =
  'grid min-h-[186px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-7 rounded-xl bg-card px-7 py-3.5 hairline border-stroke-3';

/** 全部牌组的今日汇总。available 是三项之和，total 用于反推已排期。 */
interface DeckTotals {
  fresh: number;
  learning: number;
  due: number;
  available: number;
  total: number;
}

/** 一个牌组当前可学习的卡片数。 */
function availableCount(group: CardGroupSummary): number {
  return group.unlearned + group.learning + group.due;
}

/** 一个牌组已排期、尚未到期的卡片数。 */
function scheduledCount(group: CardGroupSummary): number {
  return group.total - availableCount(group);
}

/** 预估完成 N 张卡所需分钟数。 */
function estimateMinutes(count: number): number {
  return Math.max(1, Math.round((count * SECONDS_PER_CARD) / 60));
}

/**
 * 等 DropdownMenu 收起后再开 Dialog。
 * 两个 Radix 焦点域同时存在时，后开的 Dialog 会抢不到焦点。
 */
function deferMenuAction(action: () => void) {
  window.setTimeout(action, 200);
}

/** 闪卡主页：今日带 + 双列牌组卡。 */
export function Flashcard() {
  const addTab = useTabsStore(s => s.addTab);
  const [groups, setGroups] = useState<CardGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [renameTarget, setRenameTarget] = useState<CardGroupSummary | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CardGroupSummary | null>(null);
  const { openCreateCard, cardEditDialog } = useCardEditDialog();

  const totals = useMemo<DeckTotals>(
    () =>
      groups.reduce(
        (sum, group) => {
          sum.fresh += group.unlearned;
          sum.learning += group.learning;
          sum.due += group.due;
          sum.available += availableCount(group);
          sum.total += group.total;
          return sum;
        },
        { fresh: 0, learning: 0, due: 0, available: 0, total: 0 }
      ),
    [groups]
  );

  const sortedGroups = useMemo(
    () =>
      [...groups].sort(
        (left, right) =>
          availableCount(right) - availableCount(left) ||
          right.due - left.due ||
          left.name.localeCompare(right.name, 'zh')
      ),
    [groups]
  );

  const maxAvailable = useMemo(
    () => sortedGroups.reduce((max, group) => Math.max(max, availableCount(group)), 0),
    [sortedGroups]
  );

  /** 加载牌组统计。 */
  const loadGroups = useCallback(async () => {
    const result = await window.api.listCardGroups();
    if (!result.success || !result.groups) {
      toast.error(result.error ?? '加载牌组失败');
      setLoading(false);
      return;
    }
    setGroups(result.groups);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGroups(), 0);
    return () => window.clearTimeout(timer);
  }, [loadGroups]);

  useEffect(() => {
    const refresh = () => void loadGroups();
    window.addEventListener('flashcards:changed', refresh);
    return () => window.removeEventListener('flashcards:changed', refresh);
  }, [loadGroups]);

  /** 打开全部卡片浏览页；带牌组时按牌组筛选。 */
  function openBrowser(groupId?: string) {
    addTab('card-browser', {
      groupId,
      title: '闪卡浏览',
    });
  }

  /** 打开全部牌组的今日复习页。 */
  function openTodayReview() {
    addTab('card-review', { title: '今日复习' });
  }

  /** 打开选中牌组的复习页。 */
  function openReview(group: CardGroupSummary) {
    addTab('card-review', {
      groupId: group.id,
      title: `复习 · ${group.name}`,
    });
  }

  /** 在当前页直接弹出新增卡片窗口；未指定牌组时落在待办最多的牌组。 */
  function handleCreateCard(groupId?: string) {
    openCreateCard(groupId ?? sortedGroups[0]?.id);
  }

  /** 创建牌组。 */
  async function handleCreateGroup() {
    const name = createName.trim();
    if (!name) {
      toast.error('请输入牌组名称');
      return;
    }
    const result = await window.api.createCardGroup({ name });
    if (!result.success) {
      toast.error(result.error ?? '创建牌组失败');
      return;
    }
    setCreateName('');
    setCreateOpen(false);
    toast.success('牌组已创建');
    await loadGroups();
  }

  /** 打开重命名对话框。 */
  function openRename(group: CardGroupSummary) {
    setRenameTarget(group);
    setRenameName(group.name);
  }

  /** 保存牌组名称。 */
  async function handleRenameGroup() {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) {
      toast.error('请输入牌组名称');
      return;
    }
    const result = await window.api.renameCardGroup({ id: renameTarget.id, name });
    if (!result.success) {
      toast.error(result.error ?? '重命名失败');
      return;
    }
    setRenameTarget(null);
    toast.success('牌组名称已更新');
    await loadGroups();
  }

  /** 删除牌组及其卡片。 */
  async function handleDeleteGroup() {
    if (!deleteTarget) return;
    const result = await window.api.deleteCardGroup({ id: deleteTarget.id });
    if (!result.success) {
      toast.error(result.error ?? '删除牌组失败');
      return;
    }
    setDeleteTarget(null);
    toast.success('牌组已删除');
    await loadGroups();
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-surface-1 text-sm text-muted-foreground">
        加载闪卡数据…
      </div>
    );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-surface-1 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <header className="h-12 shrink-0 border-b border-stroke-3 bg-background px-6">
        <div className="mx-auto flex h-full w-full max-w-[1040px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-body-lg font-semibold tracking-tight">闪卡</h1>
            <span className="truncate text-xs text-ink-tertiary tabular-nums">
              {groups.length} 个牌组 · {totals.total} 张卡片
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" disabled={!groups.length} onClick={() => openBrowser()}>
              <GalleryHorizontalEnd />
              浏览卡片
            </Button>
            <Button variant="outline" disabled={!groups.length} onClick={() => handleCreateCard()}>
              <Plus />
              新增卡片
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1" scrollBarClassName="w-2">
        <div className="p-6">
          <div className="mx-auto max-w-[1040px]">
            {groups.length ? (
              <>
                <TodayBand totals={totals} onStart={openTodayReview} />
                <section className="mt-5">
                  <div className="mb-3 flex items-center gap-4">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-sm font-semibold">我的牌组</h2>
                      <span className="text-xs text-ink-tertiary tabular-nums">
                        {groups.length} 个
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus />
                      新建牌组
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {sortedGroups.map(group => (
                      <DeckCard
                        key={group.id}
                        group={group}
                        maxAvailable={maxAvailable}
                        onBrowse={() => openBrowser(group.id)}
                        onReview={() => openReview(group)}
                        onCreateCard={() => handleCreateCard(group.id)}
                        onRename={() => openRename(group)}
                        onDelete={() => setDeleteTarget(group)}
                      />
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
                <EmptyGroups onCreate={() => setCreateOpen(true)} />
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {cardEditDialog}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建牌组</DialogTitle>
            <DialogDescription>牌组用于组织卡片并独立计算复习进度。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={createName}
            onChange={event => setCreateName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleCreateGroup();
            }}
            placeholder="例如：英语词汇"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={() => void handleCreateGroup()}>创建牌组</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={open => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名牌组</DialogTitle>
            <DialogDescription>修改牌组名称不会影响其中的卡片和复习进度。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={event => setRenameName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleRenameGroup();
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={() => void handleRenameGroup()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除牌组“{deleteTarget?.name}”</AlertDialogTitle>
            <AlertDialogDescription>
              该操作会级联删除牌组中的 {deleteTarget?.total ?? 0} 张卡片，并且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">取消</AlertDialogCancel>
            <AlertDialogAction className="cursor-pointer" onClick={() => void handleDeleteGroup()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 今日带：中间是环形构成，左侧是时间，右侧是主入口。 */
function TodayBand({ totals, onStart }: { totals: DeckTotals; onStart: () => void }) {
  const hasDue = totals.learning + totals.due > 0;
  const hasFresh = totals.fresh > 0;
  const scheduled = totals.total - totals.available;

  if (!hasDue && !hasFresh) {
    return (
      <section className={BAND_CLASS} aria-label="今日状态">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <p className="text-xs tracking-wide text-ink-tertiary">今日</p>
          <h2 className="text-lg font-semibold">今天没有待办</h2>
          <p className="text-xs text-ink-tertiary">下一批卡片到期后会自动加入。</p>
        </div>
        <StatusDisc tone="muted">
          <Clock className="size-10" aria-hidden="true" />
        </StatusDisc>
        <div className="flex flex-col items-end gap-1.5 text-right">
          <span className="text-xs text-ink-tertiary tabular-nums">已排期 {scheduled} 张</span>
        </div>
      </section>
    );
  }

  if (!hasDue) {
    return (
      <section className={BAND_CLASS} aria-label="今日状态">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <p className="text-xs tracking-wide text-ink-tertiary">今日</p>
          <h2 className="text-lg font-semibold">到期卡片已清空</h2>
          <p className="text-xs text-ink-tertiary">
            还有 <span className="font-semibold text-foreground">{totals.fresh}</span>{' '}
            张新卡可以提前学，约 {estimateMinutes(totals.fresh)} 分钟。
          </p>
        </div>
        <StatusDisc tone="success">
          <Check className="size-10" aria-hidden="true" />
        </StatusDisc>
        <div className="flex flex-col items-end gap-1.5 text-right">
          <Button variant="outline" size="lg" onClick={onStart}>
            学习新卡
            <ArrowRight />
          </Button>
          <span className="text-xs text-ink-tertiary tabular-nums">已排期 {scheduled} 张</span>
        </div>
      </section>
    );
  }

  return (
    <section className={BAND_CLASS} aria-label="今日待办">
      <div className="flex min-w-0 flex-col items-start gap-2">
        <p className="text-xs tracking-wide text-ink-tertiary">今日待办</p>
        <p className="flex items-center gap-1.5 text-xs text-ink-tertiary tabular-nums">
          <Clock className="size-3.5" aria-hidden="true" />约 {estimateMinutes(totals.available)}{' '}
          分钟
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <CompositionRing fresh={totals.fresh} learning={totals.learning} due={totals.due} />
        <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5">
          <CountChip tone="new" label="新卡" value={totals.fresh} />
          <CountChip
            tone="learning"
            label="学习中"
            value={totals.learning}
            hint="已到期的学习中卡片"
          />
          <CountChip tone="due" label="到期复习" value={totals.due} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 text-right">
        <Button size="lg" onClick={onStart}>
          开始今日复习
          <ArrowRight />
        </Button>
        <span className="text-xs text-ink-tertiary tabular-nums">已排期 {scheduled} 张</span>
      </div>
    </section>
  );
}

/** 今日带中间的完成 / 静默圆盘。 */
function StatusDisc({ tone, children }: { tone: 'success' | 'muted'; children: ReactNode }) {
  return (
    <div
      className={
        tone === 'success'
          ? 'grid size-28 place-items-center rounded-full bg-success-surface text-success-ink'
          : 'grid size-28 place-items-center rounded-full bg-surface-2 text-ink-tertiary'
      }
    >
      {children}
    </div>
  );
}

/** 待办构成环；环上的缺口是段间留白，不是进度。 */
function CompositionRing({
  fresh,
  learning,
  due,
}: {
  fresh: number;
  learning: number;
  due: number;
}) {
  const total = fresh + learning + due;
  const circumference = 2 * Math.PI * 52;
  const segments = [
    { count: fresh, className: 'stroke-info-ink' },
    { count: learning, className: 'stroke-warn-ink' },
    { count: due, className: 'stroke-foreground' },
  ].filter(segment => segment.count > 0);

  let offset = 0;
  const circles = segments.map(segment => {
    const length = (segment.count / total) * circumference;
    const dash = Math.max(length - 3, 1);
    const circle = (
      <circle
        key={segment.className}
        className={`fill-none ${segment.className}`}
        cx="60"
        cy="60"
        r="52"
        strokeWidth={12}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
      />
    );
    offset += length;
    return circle;
  });

  return (
    <div
      className="relative size-[132px]"
      role="img"
      aria-label={`待办构成：新卡 ${fresh}、学习中 ${learning}、到期复习 ${due}`}
    >
      <svg className="size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="fill-none stroke-surface-3" cx="60" cy="60" r="52" strokeWidth={12} />
        {circles}
      </svg>
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-px"
        aria-hidden="true"
      >
        <strong className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
          {total}
        </strong>
        <span className="text-xs text-ink-tertiary">张待复习</span>
      </div>
    </div>
  );
}

/** 今日带上的一项构成数字。 */
function CountChip({
  tone,
  label,
  value,
  hint,
}: {
  tone: 'new' | 'learning' | 'due';
  label: string;
  value: number;
  hint?: string;
}) {
  const dotClass = {
    new: 'bg-info-ink',
    learning: 'bg-warn-ink',
    due: 'bg-foreground',
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary" title={hint}>
      <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </span>
  );
}

/** 牌组卡里的待办构成条；长度按最大待办量缩放。 */
function CompositionBar({
  group,
  maxAvailable,
}: {
  group: CardGroupSummary;
  maxAvailable: number;
}) {
  const available = availableCount(group);
  if (!available) return <div className="h-1.5" aria-hidden="true" />;

  const width = Math.max((available / maxAvailable) * 100, 2.5);
  const segments = [
    { count: group.unlearned, className: 'bg-info-ink' },
    { count: group.learning, className: 'bg-warn-ink' },
    { count: group.due, className: 'bg-foreground' },
  ].filter(segment => segment.count > 0);

  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      role="img"
      aria-label={`待办构成：新卡 ${group.unlearned}、学习中 ${group.learning}、到期复习 ${group.due}`}
    >
      <span
        className="flex h-full gap-px overflow-hidden rounded-full bg-card"
        style={{ width: `${width}%` }}
      >
        {segments.map(segment => (
          <span
            key={segment.className}
            className={`block h-full min-w-0.5 ${segment.className}`}
            style={{ flex: segment.count }}
          />
        ))}
      </span>
    </div>
  );
}

/** 双列牌组卡：名称区打开浏览，复习按钮进入队列，⋯ 里放管理动作。 */
function DeckCard({
  group,
  maxAvailable,
  onBrowse,
  onReview,
  onCreateCard,
  onRename,
  onDelete,
}: {
  group: CardGroupSummary;
  maxAvailable: number;
  onBrowse: () => void;
  onReview: () => void;
  onCreateCard: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const available = availableCount(group);
  const scheduled = scheduledCount(group);
  const actionLabel = group.due + group.learning > 0 ? '复习' : '学习';

  return (
    <article className="flex flex-col gap-3 rounded-xl bg-card px-4 py-3 hairline border-stroke-3 transition-[background-color,border-color] duration-200 hover:border-stroke-4 hover:bg-surface-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onBrowse}
          aria-label={`打开「${group.name}」的卡片列表`}
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-xs font-semibold leading-none text-ink-secondary"
            aria-hidden="true"
          >
            {group.name.trim().charAt(0)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium leading-5">{group.name}</span>
            <span className="truncate text-xs leading-4 text-ink-tertiary tabular-nums">
              共 {group.total} 张 · 已排期 {scheduled}
            </span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`${group.name} 的更多操作`}
              className="-mt-1 -mr-1"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => deferMenuAction(onCreateCard)}
            >
              <Plus />
              新增卡片
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onSelect={() => deferMenuAction(onRename)}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onSelect={() => deferMenuAction(onDelete)}
            >
              <Trash2 />
              删除牌组
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CompositionBar group={group} maxAvailable={maxAvailable} />

      <div className="flex min-h-7 items-center justify-between gap-3">
        {available ? (
          <span className="flex items-baseline gap-1.5 text-xs text-ink-tertiary">
            <strong className="text-xl leading-none font-semibold text-foreground tabular-nums">
              {available}
            </strong>
            张待办
          </span>
        ) : (
          <span className="text-xs text-ink-tertiary">今天没有待办</span>
        )}
        {available ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onReview}
            aria-label={`${actionLabel} ${available} 张（${group.name}）`}
          >
            {actionLabel}
            <ArrowRight />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/** 无牌组时的空状态。 */
function EmptyGroups({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary-surface text-primary">
        <Layers3 />
      </div>
      <h3 className="text-body-lg font-medium">还没有牌组</h3>
      <p className="mt-1 max-w-sm text-body text-ink-tertiary">
        牌组用来归类卡片，复习进度也按牌组独立计算。
      </p>
      <p className="mt-1 text-xs text-ink-caption">也可以先在对话里让 AI 从书中生成卡片。</p>
      <Button className="mt-5" onClick={onCreate}>
        <Plus />
        创建第一个牌组
      </Button>
    </div>
  );
}
