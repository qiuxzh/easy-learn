import { Fragment, useEffect, useMemo, useRef } from 'react';
import {
  BookMarked,
  BookOpen,
  House,
  Layers,
  Library,
  MessageCircle,
  Pin,
  PinOff,
  Repeat2,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { useTabsStore, type Tab, type TabType } from '@/stores/tabs-store';

/** 只让相同固定状态的标签参与碰撞检测。 */
const tabCollisionDetection: CollisionDetection = args => {
  const activePinned = args.active.data.current?.pinned;
  if (typeof activePinned !== 'boolean') return closestCenter(args);

  const droppableContainers = args.droppableContainers.filter(
    container => container.data.current?.pinned === activePinned
  );
  return closestCenter({ ...args, droppableContainers });
};

/**
 * 拖拽时固定 Y 轴，只保留横向位移。
 * 标签条只有 40px 高，纵向跟手会被 overflow-y-hidden 裁切，标签反复进出可视区就会闪烁。
 */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

const TAB_DRAG_MODIFIERS: Modifier[] = [restrictToHorizontalAxis];

/** 各 Tab 类型的图标，用于在标签栏里快速识别内容。 */
const TAB_ICONS: Record<TabType, LucideIcon> = {
  home: House,
  chat: MessageCircle,
  bookshelf: BookOpen,
  library: Library,
  'card-management': WalletCards,
  'card-browser': Layers,
  'card-review': Repeat2,
  reader: BookMarked,
};

/** 顶部 Tab 标签条 */
export function TabsBar() {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const activateTab = useTabsStore(s => s.activateTab);
  const closeTab = useTabsStore(s => s.closeTab);
  const closeOtherTabs = useTabsStore(s => s.closeOtherTabs);
  const pinTab = useTabsStore(s => s.pinTab);
  const unpinTab = useTabsStore(s => s.unpinTab);
  const reorderTabs = useTabsStore(s => s.reorderTabs);
  const stripRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const tabIds = useMemo(() => tabs.map(tab => tab.id), [tabs]);

  /** 拖动结束后提交新的标签顺序。 */
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderTabs(String(active.id), String(over.id));
  };

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    /** 纵向滚轮转成横向滚动；没有溢出不拦截，避免影响滚轮默认行为。 */
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (strip.scrollWidth <= strip.clientWidth) return;

      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };

    strip.addEventListener('wheel', handleWheel, { passive: false });
    return () => strip.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!activeTabId) return;

    const strip = stripRef.current;
    const activeTab = Array.from(strip?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []).find(
      tab => tab.dataset.tabId === activeTabId
    );

    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs]);

  return (
    <div
      className="relative flex flex-1 items-center min-w-0 pl-4"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      {/* 底边线只覆盖标签条，避免压到左侧导航和右上角窗口控件 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-4 right-0 h-px bg-stroke-3"
      />
      <div
        ref={stripRef}
        className="tab-strip flex h-10 min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden px-2"
      >
        {/*拖动功能*/}
        <DndContext
          sensors={sensors}
          collisionDetection={tabCollisionDetection}
          modifiers={TAB_DRAG_MODIFIERS}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const previousTab = tabs[index - 1];
              const groupChanged = previousTab ? previousTab.pinned !== tab.pinned : false;
              const showDivider =
                Boolean(previousTab) &&
                (groupChanged || (!isActive && previousTab.id !== activeTabId));

              return (
                <Fragment key={tab.id}>
                  {showDivider && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-px shrink-0 self-end mb-2.5',
                        groupChanged ? 'mx-2 h-4 bg-stroke-3' : 'h-3 bg-stroke-2'
                      )}
                    />
                  )}
                  <SortableTabItem
                    tab={tab}
                    active={isActive}
                    hasOtherClosableTabs={tabs.some(item => item.id !== tab.id && !item.pinned)}
                    onActivate={() => activateTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                    onCloseOthers={() => closeOtherTabs(tab.id)}
                    onTogglePin={() => (tab.pinned ? unpinTab(tab.id) : pinTab(tab.id))}
                  />
                </Fragment>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  active: boolean;
  hasOtherClosableTabs: boolean;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onTogglePin: () => void;
}

/** 可拖动、带右键菜单的标签项。 */
function SortableTabItem({
  tab,
  active,
  hasOtherClosableTabs,
  onActivate,
  onClose,
  onCloseOthers,
  onTogglePin,
}: TabItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, data: { pinned: tab.pinned } });
  const TabIcon = TAB_ICONS[tab.type];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    WebkitAppRegion: 'no-drag',
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      className={cn(
        'group relative max-w-[184px] cursor-pointer',
        tab.pinned ? 'min-w-[72px]' : 'min-w-[96px]',
        active && 'z-10',
        isDragging && 'z-30 opacity-60'
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative">
            <button
              ref={setActivatorNodeRef}
              type="button"
              title={tab.pinned ? `${tab.title}（已固定）` : tab.title}
              className={cn(
                'relative flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-t-sm pl-2.5 text-body transition-colors select-none',
                tab.pinned ? 'pr-2.5' : 'pr-7',
                active
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-hover-fill hover:text-foreground'
              )}
              onClick={onActivate}
              {...attributes}
              {...listeners}
            >
              <TabIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
            </button>
            {!tab.pinned && (
              <button
                type="button"
                className={cn(
                  'absolute top-1/2 right-0.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xs transition-opacity hover:bg-hover-fill-strong hover:opacity-100 focus-visible:opacity-100',
                  active
                    ? 'opacity-60'
                    : 'opacity-0 group-focus-within:opacity-60 group-hover:opacity-60'
                )}
                onClick={onClose}
                title="关闭标签页"
                aria-label="关闭标签页"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={onTogglePin}>
            {tab.pinned ? <PinOff className="size-3.5!" /> : <Pin />}
            {tab.pinned ? '取消固定' : '固定标签页'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onClose}>
            <X className="size-3.5!" />
            关闭
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasOtherClosableTabs} onSelect={onCloseOthers}>
            <X className="size-3.5!" />
            关闭其他标签页
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
