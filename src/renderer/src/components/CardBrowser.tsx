import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  GalleryHorizontalEnd,
  Layers3,
  Plus,
  Search,
  SearchX,
  SquareStack,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { CardEditor } from '@/components/CardEditor';
import { FloatingPanel } from '@/components/FloatingPanel';
import { useCardEditDialog } from '@/hooks/use-card-edit-dialog';
import { Chat } from '@/pages/Chat';
import { useTabsStore } from '@/stores/tabs-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CardGroupSummary, CardRecord } from '@shared/types/flashcards';

/** 卡片列表每页显示数量。 */
const CARD_PAGE_SIZE = 50;

/** 卡片表格列默认宽度与最小宽度。 */
const CARD_COLUMNS = [
  { key: 'content', label: '内容', width: 240, minWidth: 160 },
  { key: 'tags', label: '标签', width: 130, minWidth: 80 },
  { key: 'group', label: '分组', width: 90, minWidth: 70 },
  { key: 'status', label: '状态', width: 85, minWidth: 70 },
  { key: 'due', label: '下次出现', width: 90, minWidth: 80 },
  { key: 'reps', label: '复习次数', width: 90, minWidth: 75 },
  { key: 'interval', label: '间隔', width: 70, minWidth: 60 },
] as const;

/** 卡片浏览页属性。 */
interface CardBrowserProps {
  /** 本 Tab 的实例 id，用于判断自身是否为当前激活页。 */
  tabId?: string;
  groupId?: string;
}

/** 三栏卡片浏览页。 */
export function CardBrowser({ tabId, groupId }: CardBrowserProps) {
  const browserRootRef = useRef<HTMLDivElement>(null);
  /** 本页是否为当前激活的 Tab；TabContent 用 hidden 保留其他页，这里据此收起浮层。 */
  const isActiveTab = useTabsStore(s => s.activeTabId === tabId);
  const [groups, setGroups] = useState<CardGroupSummary[]>([]);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(groupId ?? '');
  const [selectedTag, setSelectedTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const selectedCard = useMemo(
    () => cards.find(card => card.id === selectedCardId),
    [cards, selectedCardId]
  );
  /** 是否已创建过 AI 助手浮层；一旦为 true 就不再复位，使 Chat 组件常驻并保留会话。 */
  const [assistantMounted, setAssistantMounted] = useState(false);
  /** 用户是否主动打开了 AI 助手；关闭只隐藏组件，会话留到下次打开。 */
  const [assistantOpen, setAssistantOpen] = useState(false);
  /** 浮层实际可见性：切离本页时自动收起，组件仍挂载，会话不丢。 */
  const assistantVisible = assistantOpen && isActiveTab;
  const editorVisible = Boolean(selectedCard);
  const [page, setPage] = useState(1);
  // 新增卡片后回到第一页，列表由 flashcards:changed 事件刷新
  const { openCreateCard, cardEditDialog } = useCardEditDialog({ onSaved: () => setPage(1) });
  const filteredCards = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter(card => {
      const content =
        `${plainText(card.fields.front)} ${plainText(card.fields.back)}`.toLowerCase();
      return content.includes(query);
    });
  }, [cards, searchQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / CARD_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleCards = useMemo(
    () => filteredCards.slice((safePage - 1) * CARD_PAGE_SIZE, safePage * CARD_PAGE_SIZE),
    [filteredCards, safePage]
  );
  /** 加载牌组、标签和符合筛选条件的卡片。 */
  const load = useCallback(async () => {
    const [groupsResult, cardsResult] = await Promise.all([
      window.api.listCardGroups(),
      window.api.listCards({
        groupId: selectedGroupId || undefined,
        tag: selectedTag || undefined,
      }),
    ]);
    if (!groupsResult.success || !groupsResult.groups) {
      toast.error(groupsResult.error ?? '加载牌组失败');
      return;
    }
    if (!cardsResult.success) {
      toast.error(cardsResult.error ?? '加载卡片失败');
      return;
    }
    setGroups(groupsResult.groups);
    setCards(cardsResult.cards ?? []);
    setTags(cardsResult.tags ?? []);
    setSelectedCardId(current =>
      (cardsResult.cards ?? []).some(card => card.id === current) ? current : null
    );
  }, [selectedGroupId, selectedTag]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedGroupId(current => groupId ?? current);
      setPage(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groupId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('flashcards:changed', refresh);
    return () => window.removeEventListener('flashcards:changed', refresh);
  }, [load]);
  useEffect(() => {
    if (!editorVisible) return;

    /** 点击卡片行、编辑栏、拖动条和滚动条以外的区域时关闭编辑栏。 */
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || !browserRootRef.current?.contains(target)) return;
      if (
        target.closest(
          '[data-card-browser-row], [data-card-browser-detail], [data-card-browser-resize-handle], [data-orientation]'
        )
      )
        return;
      setSelectedCardId(null);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [editorVisible]);

  /** 选择牌组筛选。 */
  function handleSelectGroup(nextGroupId: string) {
    setSelectedGroupId(nextGroupId);
    setSelectedTag('');
    setSelectedCardId(null);
    setPage(1);
  }

  /** 更新卡片内容筛选关键词。 */
  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSelectedCardId(null);
    setPage(1);
  }

  /** 选择标签筛选。 */
  function handleSelectTag(nextTag: string) {
    setSelectedTag(current => (current === nextTag ? '' : nextTag));
    setSelectedCardId(null);
    setPage(1);
  }

  /** 打开 AI 助手浮层：首次打开才创建，之后复用同一个 Chat 实例以保留会话。 */
  function handleOpenAssistant() {
    setAssistantMounted(true);
    setAssistantOpen(true);
  }

  /** 打开新增卡片弹窗，同时关闭右侧编辑栏。 */
  function handleCreateCard() {
    setSelectedCardId(null);
    openCreateCard(groupId ?? selectedGroupId ?? groups[0]?.id);
  }

  /** 点击卡片后直接进入编辑栏。 */
  function handleSelectCard(cardId: string) {
    setSelectedCardId(cardId);
  }

  /** 关闭右侧编辑栏。 */
  function handleCloseEditor() {
    setSelectedCardId(null);
  }

  /** 保存后立即更新列表中的卡片内容。 */
  function handleEditorSaved(savedCard: CardRecord) {
    setCards(current => current.map(card => (card.id === savedCard.id ? savedCard : card)));
  }

  /** 删除卡片后关闭编辑栏并刷新列表。 */
  function handleDeleted() {
    setSelectedCardId(null);
    setPage(1);
    void load();
  }

  return (
    <div
      ref={browserRootRef}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/15 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed"
    >
      <div className="flex items-center justify-between gap-4 border-b bg-background/80 px-5 py-3 backdrop-blur">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <GalleryHorizontalEnd className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">闪卡浏览</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchQuery}
              onChange={event => handleSearchChange(event.target.value)}
              placeholder="筛选卡片内容"
              aria-label="筛选卡片内容"
              className="h-9 pl-9 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Badge variant="secondary">{filteredCards.length} 张卡片</Badge>
          <Button size="sm" onClick={handleCreateCard}>
            <Plus />
            新增卡片
          </Button>
          <Button
            size="sm"
            variant={assistantVisible ? 'secondary' : 'outline'}
            aria-pressed={assistantVisible}
            onClick={handleOpenAssistant}
          >
            <Bot />
            AI 助手
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel
            defaultSize="22%"
            minSize="18%"
            maxSize="30%"
            className="min-w-0 bg-background"
          >
            <FilterPanel
              groups={groups}
              tags={tags}
              selectedGroupId={selectedGroupId}
              selectedTag={selectedTag}
              onSelectGroup={handleSelectGroup}
              onSelectTag={handleSelectTag}
            />
          </ResizablePanel>
          <ResizableHandle data-card-browser-resize-handle className="cursor-col-resize" />
          <ResizablePanel
            defaultSize={editorVisible ? '43%' : '78%'}
            minSize="30%"
            className="min-w-0"
          >
            <CardListPanel
              cards={visibleCards}
              totalCards={filteredCards.length}
              groups={groups}
              selectedCardId={selectedCardId}
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
              onSelectCard={handleSelectCard}
            />
          </ResizablePanel>
          {selectedCard && (
            <>
              <ResizableHandle data-card-browser-resize-handle className="cursor-col-resize" />
              <ResizablePanel
                data-card-browser-detail
                defaultSize="35%"
                minSize="25%"
                maxSize="50%"
                className="min-w-0"
              >
                <CardEditor
                  key={selectedCard.id}
                  card={selectedCard}
                  onClose={handleCloseEditor}
                  onSaved={handleEditorSaved}
                  onDeleted={handleDeleted}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      {cardEditDialog}
      {/* AI 助手浮层：挂载后不再卸载，关闭只是隐藏，从而保留对话进度 */}
      {assistantMounted && (
        <FloatingPanel
          open={assistantVisible}
          onClose={() => setAssistantOpen(false)}
          title="AI 助手"
          storageKey="flashcard-assistant-size"
        >
          <Chat />
        </FloatingPanel>
      )}
    </div>
  );
}

/** 左侧牌组和标签筛选面板。 */
function FilterPanel({
  groups,
  tags,
  selectedGroupId,
  selectedTag,
  onSelectGroup,
  onSelectTag,
}: {
  groups: CardGroupSummary[];
  tags: string[];
  selectedGroupId: string;
  selectedTag: string;
  onSelectGroup: (id: string) => void;
  onSelectTag: (tag: string) => void;
}) {
  const totalCards = groups.reduce((total, group) => total + group.total, 0);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        <div>
          <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers3 className="size-3.5" />
            牌组
          </p>
          <div className="space-y-1">
            <FilterButton
              active={!selectedGroupId}
              icon={<Layers3 />}
              label="全部牌组"
              count={totalCards}
              onClick={() => onSelectGroup('')}
            />
            {groups.map(group => (
              <FilterButton
                key={group.id}
                active={selectedGroupId === group.id}
                icon={<SquareStack />}
                label={group.name}
                count={group.total}
                onClick={() => onSelectGroup(group.id)}
              />
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Tag className="size-3.5" />
            标签
          </p>
          <div className="space-y-1">
            {tags.length ? (
              tags.map(tag => (
                <FilterButton
                  key={tag}
                  active={selectedTag === tag}
                  icon={<Tag />}
                  label={tag}
                  onClick={() => onSelectTag(tag)}
                />
              ))
            ) : (
              <p className="px-2 text-sm text-muted-foreground">暂无标签</p>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

/** 左侧筛选按钮。 */
function FilterButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      className="h-9 w-full justify-start gap-2 px-2.5 font-normal"
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </Button>
  );
}

/** 中间卡片列表面板。 */
function CardListPanel({
  cards,
  totalCards,
  groups,
  selectedCardId,
  page,
  pageCount,
  onPageChange,
  onSelectCard,
}: {
  cards: CardRecord[];
  totalCards: number;
  groups: CardGroupSummary[];
  selectedCardId: string | null;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onSelectCard: (id: string) => void;
}) {
  const groupNames = useMemo(() => new Map(groups.map(group => [group.id, group.name])), [groups]);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    CARD_COLUMNS.map(column => column.width)
  );
  /** 正在拖动的列索引，仅用于拖动期间锁住全局光标 */
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);

  // 拖动期间锁住全局光标并禁止选中文本，指针移出表格时状态也不会丢
  useEffect(() => {
    if (resizingColumn === null) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingColumn]);

  /**
   * 拖动两列之间的竖线：左列加宽多少，右列就收窄多少，两列宽度之和保持不变。
   * 表格总宽不变，其余列的宽度也不变，所以整张表只有被拖的这条竖线会移动。
   */
  function handleColumnResizeStart(index: number, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();

    const column = CARD_COLUMNS[index];
    const nextColumn = CARD_COLUMNS[index + 1];
    const startX = event.clientX;
    const startWidth = columnWidths[index];
    const pairWidth = startWidth + columnWidths[index + 1];
    // 列宽之和小于面板宽度时，表格会被按比例拉伸到面板宽度，此时逻辑宽度与渲染宽度不成 1:1。
    // 用表头单元格的实际渲染宽度反推拉伸系数，保证指针移动多少像素、竖线就移动多少像素。
    const renderedWidth =
      event.currentTarget.parentElement?.getBoundingClientRect().width ?? startWidth;
    const scale = renderedWidth > 0 ? startWidth / renderedWidth : 1;

    setResizingColumn(index);

    /** 拖动中：把指针位移换算成左列宽度，右列取这一对列剩下的额度 */
    function handlePointerMove(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) * scale;
      const nextWidth = Math.min(
        pairWidth - nextColumn.minWidth,
        Math.max(column.minWidth, startWidth + delta)
      );
      setColumnWidths(current =>
        current.map((width, columnIndex) => {
          if (columnIndex === index) return nextWidth;
          if (columnIndex === index + 1) return pairWidth - nextWidth;
          return width;
        })
      );
    }

    /** 收尾：摘下监听，让光标锁定的 effect 复位 */
    function cleanup() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      setResizingColumn(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1" showHorizontalScrollBar>
        <div className="min-w-full" style={{ width: tableWidth }}>
          {cards.length ? (
            <Table className="table-fixed">
              <colgroup>
                {CARD_COLUMNS.map((column, index) => (
                  <col key={column.key} style={{ width: columnWidths[index] }} />
                ))}
              </colgroup>
              <TableHeader className="bg-muted/70 [&_th]:font-semibold">
                <TableRow>
                  {CARD_COLUMNS.map((column, index) => (
                    <TableHead
                      key={column.key}
                      className={`relative ${
                        index === 0
                          ? 'pl-5 pr-3'
                          : index === CARD_COLUMNS.length - 1
                            ? 'pr-5'
                            : 'px-2 pr-3'
                      } ${index < CARD_COLUMNS.length - 1 ? 'border-r border-border/60' : ''}`}
                    >
                      {column.label}
                      {/* 最后一列右侧就是表格边缘，没有右邻列可以让出宽度，因此不放手柄 */}
                      {index < CARD_COLUMNS.length - 1 && (
                        <span
                          aria-hidden="true"
                          data-card-browser-resize-handle
                          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize select-none after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-border"
                          onPointerDown={event => handleColumnResizeStart(index, event)}
                        />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map(card => (
                  <CardListRow
                    key={card.id}
                    card={card}
                    groupName={groupNames.get(card.groupId) ?? '未知牌组'}
                    active={selectedCardId === card.id}
                    onClick={() => onSelectCard(card.id)}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyPanel
                icon={<SearchX />}
                title="没有找到卡片"
                description="尝试切换牌组、标签或修改筛选内容"
              />
            </div>
          )}
        </div>
      </ScrollArea>
      <CardPagination
        page={page}
        pageCount={pageCount}
        totalCards={totalCards}
        onPageChange={onPageChange}
      />
    </div>
  );
}

/** 中间列表中的单张卡片行。 */
function CardListRow({
  card,
  groupName,
  active,
  onClick,
}: {
  card: CardRecord;
  groupName: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <TableRow
      data-card-browser-row
      data-state={active ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={onClick}
    >
      <TableCell className="border-r border-border/60 overflow-hidden pl-5 pr-3">
        <p className="line-clamp-2 text-sm font-medium leading-5">{plainText(card.fields.front)}</p>
      </TableCell>
      <TableCell className="border-r border-border/60 overflow-hidden px-2 pr-3">
        <div className="flex flex-wrap gap-1">
          {card.tags.length ? (
            card.tags.slice(0, 3).map(tag => (
              <Badge
                key={tag}
                variant="secondary"
                className="max-w-32 truncate text-[11px] font-normal"
              >
                #{tag}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">无标签</span>
          )}
          {card.tags.length > 3 && (
            <span className="text-xs text-muted-foreground">+{card.tags.length - 3}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="border-r border-border/60 truncate px-2 pr-3 text-xs text-muted-foreground">
        {groupName}
      </TableCell>
      <TableCell className="border-r border-border/60 px-2 pr-3">
        <StatusBadge state={card.state} />
      </TableCell>
      <TableCell className="border-r border-border/60 whitespace-nowrap px-2 pr-3 text-xs text-muted-foreground">
        {formatReviewDue(card)}
      </TableCell>
      <TableCell className="border-r border-border/60 px-2 pr-3 text-center text-xs tabular-nums">
        {card.reps}
      </TableCell>
      <TableCell className="pr-5 text-xs tabular-nums text-muted-foreground">
        {formatInterval(card.scheduledDays)}
      </TableCell>
    </TableRow>
  );
}

/** 分页控制器，默认每页显示 50 张卡片。 */
function CardPagination({
  page,
  pageCount,
  totalCards,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  totalCards: number;
  onPageChange: (page: number) => void;
}) {
  const start = totalCards ? (page - 1) * CARD_PAGE_SIZE + 1 : 0;
  const end = Math.min(page * CARD_PAGE_SIZE, totalCards);

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background/60 px-4 py-2">
      <p className="text-xs text-muted-foreground">
        {totalCards ? `显示 ${start}-${end} / 共 ${totalCards} 张` : '暂无卡片'}
      </p>
      <nav aria-label="卡片分页" className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="下一页"
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          <ChevronRight />
        </Button>
      </nav>
    </div>
  );
}

/** 格式化卡片的下一次出现时间。 */
function formatReviewDue(card: CardRecord): string {
  if (card.state === 0) return '现在';
  const remainingMs = card.due - Date.now();
  if (remainingMs <= 0) return '现在';
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes < 60) return `${remainingMinutes}分钟后`;
  const remainingHours = Math.ceil(remainingMs / 3_600_000);
  if (remainingHours < 24) return `${remainingHours}小时后`;
  const remainingDays = Math.ceil(remainingMs / 86_400_000);
  if (remainingDays === 1) return '明天';
  return `${remainingDays}天后`;
}

/** 格式化 FSRS 为卡片安排的复习间隔。 */
function formatInterval(days: number): string {
  if (days <= 0) return '短期';
  return `${days}天`;
}
/** 根据 FSRS 状态显示卡片状态。 */
function StatusBadge({ state }: { state: CardRecord['state'] }) {
  if (state === 0)
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
      >
        未学习
      </Badge>
    );
  if (state === 1 || state === 3)
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        学习中
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
    >
      复习
    </Badge>
  );
}
/** 卡片列表空状态。 */
function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="items-center justify-center border-dashed bg-transparent py-12 text-center shadow-none">
      <CardContent className="flex flex-col items-center px-6">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

/** 将 Markdown 摘要转换为列表文本。 */
function plainText(markdown: string): string {
  const symbols = new Set(['#', '*', '_', '>', '`', '[', ']', '(', ')']);
  return (
    [...markdown]
      .filter(character => !symbols.has(character))
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || '未命名卡片'
  );
}
