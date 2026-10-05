import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Clock,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CardGroupSummary } from '@shared/types/flashcards';

/** 闪卡管理页。 */
export function Flashcard() {
  const addTab = useTabsStore(s => s.addTab);
  const [groups, setGroups] = useState<CardGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [renameTarget, setRenameTarget] = useState<CardGroupSummary | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CardGroupSummary | null>(null);
  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId),
    [groups, selectedGroupId]
  );
  const totalCards = useMemo(
    () => groups.reduce((total, group) => total + group.total, 0),
    [groups]
  );
  const dueCards = useMemo(() => groups.reduce((total, group) => total + group.due, 0), [groups]);
  const newCards = useMemo(
    () => groups.reduce((total, group) => total + group.unlearned, 0),
    [groups]
  );
  const learningCards = useMemo(
    () => groups.reduce((total, group) => total + group.learning, 0),
    [groups]
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
    setSelectedGroupId(current =>
      result.groups?.some(group => group.id === current) ? current : (result.groups?.[0]?.id ?? '')
    );
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

  /** 打开全部卡片浏览页。 */
  function openBrowser(groupId?: string) {
    addTab('card-browser', {
      groupId,
      title: '闪卡浏览',
    });
  }

  /** 打开牌组浏览页并直接弹出新增卡片窗口。 */
  function openCreateCard(groupId?: string) {
    const targetGroupId = groupId ?? selectedGroupId ?? groups[0]?.id;
    if (!targetGroupId) {
      toast.error('请先创建牌组');
      return;
    }

    addTab('card-browser', {
      groupId: targetGroupId,
      createCardAt: Date.now(),
      title: '闪卡浏览',
    });
  }

  /** 打开选中牌组的复习 Tab。 */
  function openReview() {
    if (!selectedGroup) {
      toast.error('请先选择牌组');
      return;
    }
    addTab('card-review', { groupId: selectedGroup.id, title: `复习 · ${selectedGroup.name}` });
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
      <div className="flex h-full items-center justify-center bg-muted/15 text-sm text-muted-foreground">
        加载闪卡数据…
      </div>
    );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-muted/15 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <div className="border-b bg-background/80 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers3 className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">闪卡管理</h1>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => openBrowser()}>
              <Search />
              浏览卡片
            </Button>
            <Button variant="outline" disabled={!selectedGroup} onClick={openReview}>
              <RotateCcw />
              复习所选
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              新建牌组
            </Button>
            <Button onClick={() => openCreateCard()}>
              <Sparkles />
              新增卡片
            </Button>
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollBarClassName="w-2">
        <div className="p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard
                label="卡片总数"
                value={totalCards}
                detail="全部卡片"
                icon={<Layers3 />}
              />
              <SummaryCard label="未学习" value={newCards} detail="尚未学习" icon={<Sparkles />} />
              <SummaryCard
                label="学习中"
                value={learningCards}
                detail="当前待学"
                icon={<RotateCcw />}
              />
              <SummaryCard
                label="待复习"
                value={dueCards}
                detail="当前到期"
                icon={<Clock />}
                tone="primary"
              />
            </div>
            <Card className="overflow-hidden py-0">
              <CardHeader className="border-b bg-card px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">我的牌组</CardTitle>
                    {/*<CardDescription className="mt-1">*/}
                    {/*  选择牌组后可浏览卡片或开始复习。*/}
                    {/*</CardDescription>*/}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus />
                    新建牌组
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {groups.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">牌组</TableHead>
                        <TableHead>未学习</TableHead>
                        <TableHead>学习中</TableHead>
                        <TableHead>待复习</TableHead>
                        <TableHead>总数</TableHead>
                        <TableHead className="w-52 pr-6">
                          <span className="sr-only">操作</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map(group => (
                        <GroupRow
                          key={group.id}
                          group={group}
                          selected={selectedGroupId === group.id}
                          onSelect={() => setSelectedGroupId(group.id)}
                          onBrowse={() => openBrowser(group.id)}
                          onCreateCard={() => openCreateCard(group.id)}
                          onReview={() =>
                            addTab('card-review', {
                              groupId: group.id,
                              title: `复习 · ${group.name}`,
                            })
                          }
                          onRename={() => openRename(group)}
                          onDelete={() => setDeleteTarget(group)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyGroups onCreate={() => setCreateOpen(true)} />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
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
              <Button variant="outline" className="cursor-pointer">
                取消
              </Button>
            </DialogClose>
            <Button className="cursor-pointer" onClick={() => void handleCreateGroup()}>
              创建牌组
            </Button>
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
              <Button variant="outline" className="cursor-pointer">
                取消
              </Button>
            </DialogClose>
            <Button className="cursor-pointer" onClick={() => void handleRenameGroup()}>
              保存
            </Button>
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

/** 牌组统计卡片。 */
function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone = 'muted',
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone?: 'muted' | 'primary';
}) {
  return (
    <Card
      className={`h-full gap-0 py-0 shadow-none ${
        tone === 'primary' ? 'border-primary/25 bg-primary/5' : ''
      }`}
    >
      <CardContent className="flex items-center gap-3 p-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
            tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          } [&_svg]:size-4`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="text-xl font-semibold tracking-tight tabular-nums">{value}</p>
            <p className="truncate text-xs text-muted-foreground">{label}</p>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/75">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 牌组表格行。 */
function GroupRow({
  group,
  selected,
  onSelect,
  onBrowse,
  onCreateCard,
  onReview,
  onRename,
  onDelete,
}: {
  group: CardGroupSummary;
  selected: boolean;
  onSelect: () => void;
  onBrowse: () => void;
  onCreateCard: () => void;
  onReview: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const availableCount = group.unlearned + group.learning + group.due;
  const reviewOnly = group.due > 0 && group.unlearned + group.learning === 0;
  const actionLabel = availableCount === 0 ? '暂无' : reviewOnly ? '复习' : '学习';

  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={() => {
        onSelect();
        onBrowse();
      }}
    >
      <TableCell className="pl-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Layers3 className="size-4" />
          </div>
          <div>
            <p className="font-medium">{group.name}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>{group.unlearned}</TableCell>
      <TableCell>{group.learning}</TableCell>
      <TableCell>
        {group.due > 0 ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600">{group.due}</Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>
      <TableCell>{group.total}</TableCell>
      <TableCell className="pr-2" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5"
            aria-label={`向${group.name}新增卡片`}
            title="新增卡片"
            onClick={onCreateCard}
          >
            <Plus />
            新增
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5"
            disabled={availableCount === 0}
            onClick={onReview}
          >
            <RotateCcw />
            {actionLabel}
            {group.due > 0 ? (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive tabular-nums">
                {group.due}
              </span>
            ) : null}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`管理${group.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="cursor-pointer" onClick={onRename}>
                <Pencil />
                重命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 />
                删除牌组
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** 无牌组时的空状态。 */
function EmptyGroups({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Layers3 />
      </div>
      <h3 className="font-medium">还没有牌组</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        先创建一个牌组，再添加卡片开始学习。
      </p>
      <Button className="mt-5" onClick={onCreate}>
        <Plus />
        创建第一个牌组
      </Button>
    </div>
  );
}
