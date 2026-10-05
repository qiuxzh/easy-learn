import { Fragment, useMemo } from 'react';
import { Pin, PinOff, X } from 'lucide-react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTabsStore, type Tab } from '@/stores/tabs-store';

/** 只让相同固定状态的标签参与碰撞检测。 */
const tabCollisionDetection: CollisionDetection = args => {
  const activePinned = args.active.data.current?.pinned;
  if (typeof activePinned !== 'boolean') return closestCenter(args);

  const droppableContainers = args.droppableContainers.filter(
    container => container.data.current?.pinned === activePinned
  );
  return closestCenter({ ...args, droppableContainers });
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

  return (
    <div
      className="flex items-center flex-1 min-w-0 pl-8"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <ScrollArea className="flex-1 whitespace-nowrap">
        {/*拖动功能*/}
        <DndContext
          sensors={sensors}
          collisionDetection={tabCollisionDetection}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            <div className="flex items-center px-2 h-10">
              {tabs.map((tab, index) => (
                <Fragment key={tab.id}>
                  {index > 0 && (
                    <div
                      aria-hidden="true"
                      className={cn(
                        'w-px h-4 shrink-0',
                        tabs[index - 1].pinned !== tab.pinned
                          ? 'mx-2 bg-foreground/25'
                          : 'mx-1 bg-border'
                      )}
                    />
                  )}
                  <SortableTabItem
                    tab={tab}
                    active={tab.id === activeTabId}
                    hasOtherClosableTabs={tabs.some(item => item.id !== tab.id && !item.pinned)}
                    onActivate={() => activateTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                    onCloseOthers={() => closeOtherTabs(tab.id)}
                    onTogglePin={() => (tab.pinned ? unpinTab(tab.id) : pinTab(tab.id))}
                  />
                </Fragment>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    WebkitAppRegion: 'no-drag',
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('relative shrink-0', active && 'z-10', isDragging && 'z-30 opacity-60')}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative group shrink-0">
            <button
              ref={setActivatorNodeRef}
              type="button"
              title={tab.title}
              className={cn(
                'flex items-center gap-2 h-7 rounded-md cursor-grab active:cursor-grabbing select-none text-sm',
                tab.pinned ? 'pl-2.5 pr-3' : 'pl-3 pr-7',
                'min-w-[80px] max-w-[160px]',
                'hover:bg-accent/60',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              )}
              onClick={onActivate}
              {...attributes}
              {...listeners}
            >
              {tab.pinned && <Pin className="h-3 w-3 shrink-0" aria-hidden="true" />}
              <span className="truncate flex-1">{tab.title}</span>
            </button>
            {!tab.pinned && (
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-4 w-4 flex cursor-pointer items-center justify-center rounded-sm opacity-60 hover:bg-muted hover:opacity-100"
                onClick={onClose}
                title="关闭 Tab"
              >
                <X className="h-3 w-3" />
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
