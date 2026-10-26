import { useMemo, useState } from 'react';
import { MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollBar } from '@/components/ui/scroll-area';
import {
  Root as ScrollAreaRoot,
  Viewport as ScrollAreaViewport,
} from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SessionSummary } from '@shared/types/chat';
import { formatTime } from '@shared/utils/time-util';

/**
 * 会话列表（展示层）
 * ----------------------------------------------------------------
 * 数据与行为都由容器提供：ChatPage 左栏与 SideChat 历史弹层共用本组件，
 * 两者只差高度与容器，加载 / 切换 / 占用处理都在 useSessionActions 里。
 * 职责：
 *   1. 按最近活跃时间分组（今天 / 昨天 / 前天 / 一周内 / 一个月内 / 更早）
 *   2. 点击 → onSelect
 *   3. 弹窗重命名 / 直接删除 → onRename / onDelete
 */
interface SessionSummaryListProps {
  sessions: SessionSummary[];
  /** 当前激活的会话 id（用于高亮） */
  activeSessionId: string | null;
  /** sidebar：撑满父容器；popover：保持 60vh 限高 */
  variant?: 'sidebar' | 'popover';
  /** 点击会话；返回值列表不关心，调用方可据此决定是否关闭弹层 */
  onSelect: (sessionId: string) => void | Promise<unknown>;
  onRename: (sessionId: string, title: string) => void | Promise<unknown>;
  onDelete: (sessionId: string) => void | Promise<unknown>;
}

/** 时间分组键：固定 6 档 */
type GroupKey = 'today' | 'yesterday' | 'dayBeforeYesterday' | 'thisWeek' | 'thisMonth' | 'older';

/** 分组键 → 中文标签 */
const GROUP_LABELS: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  dayBeforeYesterday: '前天',
  thisWeek: '一周内',
  thisMonth: '一个月内',
  older: '一个月以上',
};

/** 分组在列表里的展示顺序 */
const GROUP_ORDER: GroupKey[] = [
  'today',
  'yesterday',
  'dayBeforeYesterday',
  'thisWeek',
  'thisMonth',
  'older',
];

/**
 * 把 updatedAt 时间戳归类到对应的时间分组（以"今天 0 点"为基准倒推）
 */
function getGroupKey(updatedAt: number, now: Date): GroupKey {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (updatedAt >= startOfToday) return 'today';
  if (updatedAt >= startOfToday - oneDay) return 'yesterday';
  if (updatedAt >= startOfToday - 2 * oneDay) return 'dayBeforeYesterday';
  if (updatedAt >= startOfToday - 7 * oneDay) return 'thisWeek';
  if (updatedAt >= startOfToday - 30 * oneDay) return 'thisMonth';
  return 'older';
}

/** 会话列表 */
export function SessionSummaryList({
  sessions,
  activeSessionId,
  variant = 'popover',
  onSelect,
  onRename,
  onDelete,
}: SessionSummaryListProps) {
  /** 正在重命名的会话；null 表示弹窗关闭。先弹窗、确认后才提交 */
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  /** 重命名请求是否在途 */
  const [renamePending, setRenamePending] = useState(false);

  const isSidebar = variant === 'sidebar';

  /**
   * 按最近活跃时间分组归类 sessions
   */
  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<GroupKey, SessionSummary[]>();
    GROUP_ORDER.forEach(k => map.set(k, []));
    sessions.forEach(session => {
      const key = getGroupKey(session.updatedAt, now);
      map.get(key)?.push(session);
    });
    // 按 GROUP_ORDER 顺序输出，空组过滤掉
    return GROUP_ORDER.map(key => ({ key, items: map.get(key) ?? [] })).filter(
      g => g.items.length > 0
    );
  }, [sessions]);

  /** 点击会话：切换失败的处理在调用方 */
  const handleSelect = async (id: string) => {
    await onSelect(id);
  };

  /**
   * 弹窗确认重命名：成功后关闭；失败保留弹窗与输入，方便重试。
   * 具体错误提示由调用方负责。
   */
  const handleRenameConfirm = async (title: string) => {
    if (!renameTarget) return;

    setRenamePending(true);
    try {
      await onRename(renameTarget.id, title);
      setRenameTarget(null);
    } catch {
      /* 保持弹窗打开 */
    } finally {
      setRenamePending(false);
    }
  };

  /** 删除单条会话 */
  const handleDelete = async (id: string) => {
    await onDelete(id);
  };

  return (
    <div className={cn('chat-session-summary-list', isSidebar && 'flex min-h-0 flex-1 flex-col')}>
      {/* 列表主体：侧栏撑满父容器；弹层高度自适应但不超过 60vh。
         w-full + min-w-0：嵌入 Popover(320px) 时不被内部 table wrapper 撑爆。 */}
      <ScrollAreaRoot
        className={cn(
          'relative w-full min-w-0 overflow-hidden',
          isSidebar ? 'min-h-0 flex-1' : 'max-h-[60vh]'
        )}
      >
        <ScrollAreaViewport
          className="w-full rounded-[inherit]"
          style={
            isSidebar
              ? { height: '100%', overflowX: 'hidden', overflowY: 'auto' }
              : { maxHeight: '60vh', overflowX: 'hidden', overflowY: 'auto' }
          }
        >
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-muted-foreground">
              <MessageCircle className="h-10 w-10 mb-2 opacity-40" />
              <div className="text-sm">暂无会话</div>
            </div>
          ) : (
            <div className="py-2">
              {grouped.map(group => (
                <div key={group.key} className="mb-3">
                  {/* 分组标题 */}
                  <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {GROUP_LABELS[group.key]}
                  </div>
                  {/* 分组条目 */}
                  <div className="px-2 space-y-0.5">
                    {group.items.map(session => {
                      const isActive = session.id === activeSessionId;
                      return (
                        <div
                          key={session.id}
                          role="button"
                          tabIndex={0}
                          title={session.title}
                          className={cn(
                            'group relative flex items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-sm cursor-pointer transition-colors',
                            isActive
                              ? 'bg-accent text-foreground'
                              : 'text-ink-secondary hover:bg-hover-fill hover:text-foreground'
                          )}
                          onClick={() => void handleSelect(session.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              void handleSelect(session.id);
                            }
                          }}
                        >
                          {/* 单行：标题占满剩余宽度，时间贴右；hover 时让位给操作菜单 */}
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {session.title || '新会话'}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0">
                            {formatTime(session.updatedAt)}
                          </span>

                          {/* 操作菜单浮在时间上，不占行宽 */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                icon
                                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                                // 阻止冒泡，否则会触发外层的 handleSelect
                                onClick={e => e.stopPropagation()}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={e => {
                                  e.stopPropagation();
                                  setRenameTarget(session);
                                }}
                              >
                                <Pencil />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleDelete(session.id);
                                }}
                              >
                                <Trash2 />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollAreaRoot>

      {renameTarget && (
        <RenameSessionDialog
          session={renameTarget}
          pending={renamePending}
          onOpenChange={open => {
            if (!open && !renamePending) {
              setRenameTarget(null);
            }
          }}
          onConfirm={title => void handleRenameConfirm(title)}
        />
      )}
    </div>
  );
}

interface RenameSessionDialogProps {
  session: SessionSummary;
  /** 重命名请求在途：按钮置忙，且不允许关闭 */
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (title: string) => void;
}

/**
 * 重命名会话弹窗：只保留标题、名称输入与确认，交互与分支会话弹窗一致。
 * 由调用方按需挂载，输入初值直接取会话标题，不需要额外的重置逻辑。
 */
function RenameSessionDialog({
  session,
  pending,
  onOpenChange,
  onConfirm,
}: RenameSessionDialogProps) {
  const [title, setTitle] = useState(session.title);
  const canSubmit = title.trim().length > 0 && !pending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm(title.trim());
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          value={title}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') handleSubmit();
          }}
          placeholder="给这个会话起个名字"
        />

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {pending ? '保存中…' : '重命名'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
