import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useSessions } from '@/hooks/use-sessions';
import { Button } from '@/components/ui/button';
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
import { SessionOccupiedError } from '@/hooks/use-chat';

/**
 * 会话历史列表
 * ----------------------------------------------------------------
 * 数据源：useSessions()（后端 DB）+ activeSessionId（高亮用）
 * 主要职责：
 *   1. 按最近活跃时间分组展示（今天 / 昨天 / 前天 / 一周内 / 一个月内 / 更早）
 *   2. 点击会话 → switchSession；被其他 tab 占用时弹 alert
 *   3. 重命名 / 删除单条会话
 * 加载策略：组件首次挂载时拉取一次；open 从 false 变 true 时再拉一次
 */
interface SessionSummaryListProps {
  /** 当前激活的会话 id（用于高亮） */
  activeSessionId: string | null;
  /** 切换到指定会话的函数，可能抛出 SessionOccupiedError（被其他 tab 占用） */
  switchSession: (sessionId: string) => Promise<void>;
  /** 点击某条会话后的回调（通常用于关闭列表面板） */
  onSelect?: () => void;
  /** 列表面板是否处于打开状态；变 true 时触发刷新 */
  open?: boolean;
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

/** 会话历史列表 */
export function SessionSummaryList({
  activeSessionId,
  switchSession,
  onSelect,
  open,
}: SessionSummaryListProps) {
  const { sessions, loadSessions, renameSession, deleteSession } = useSessions();

  // 当前正在重命名的会话 id；为 null 表示不在重命名态
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // 重命名输入框的临时值
  const [renameValue, setRenameValue] = useState('');

  /** 兜底加载：组件首次挂载时拉一次（即使父组件从未把 open 置 true，也能加载） */
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  /** 每次面板打开时刷新：保证本会话内新创建的会话能立刻展示 */
  useEffect(() => {
    if (open) void loadSessions();
  }, [open, loadSessions]);

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

  /**
   * 点击会话条目
   * - 处于重命名态时点击不切换（避免误触）
   * - 调用 switchSession：成功则关闭面板；被其他 tab 占用则弹 alert
   */
  const handleSelect = async (id: string) => {
    if (renamingId === id) return;
    try {
      await switchSession(id);
      onSelect?.();
    } catch (e) {
      if (e instanceof SessionOccupiedError) {
        alert(e.message);
      } else {
        throw e;
      }
    }
  };

  /** 进入重命名态：填充当前标题到输入框 */
  const handleStartRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  /** 提交重命名（onBlur / Enter 触发）：空值或纯空白视为取消 */
  const handleSubmitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await renameSession(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  /** 删除单条会话 */
  const handleDelete = async (id: string) => {
    await deleteSession(id);
  };

  return (
    <div className="chat-session-summary-list">
      {/* 列表标题区 */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">会话历史</h3>
      </div>

      {/* 列表主体：高度自适应但不超过 60vh。
         w-full + min-w-0：嵌入 Popover(320px) 时不被内部 table wrapper 撑爆。 */}
      <ScrollAreaRoot className="relative overflow-hidden max-h-[60vh] w-full min-w-0">
        <ScrollAreaViewport
          className="w-full rounded-[inherit]"
          style={{ maxHeight: '60vh', overflowX: 'hidden', overflowY: 'auto' }}
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
                      const isRenaming = renamingId === session.id;
                      return (
                        <div
                          key={session.id}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm cursor-pointer transition-colors',
                            isActive
                              ? 'bg-primary/10 text-foreground'
                              : 'hover:bg-accent text-foreground/80 hover:text-foreground'
                          )}
                          onClick={() => void handleSelect(session.id)}
                          onKeyDown={e => {
                            if ((e.key === 'Enter' || e.key === ' ') && !isRenaming) {
                              e.preventDefault();
                              void handleSelect(session.id);
                            }
                          }}
                        >
                          {/* 激活态的左侧高亮条 */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-primary" />
                          )}
                          {/* 会话标题 / 时间 / 重命名输入框 */}
                          <div className="flex-1 min-w-0">
                            {isRenaming ? (
                              <Input
                                autoFocus
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                // 输入框点击不能冒泡触发外层 onClick（否则会触发切换）
                                onClick={e => e.stopPropagation()}
                                onBlur={handleSubmitRename}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') void handleSubmitRename();
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                className="h-6 text-sm px-1.5"
                              />
                            ) : (
                              <div className="flex flex-col">
                                <span className="truncate font-medium">
                                  {session.title || '新会话'}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {formatTime(session.updatedAt)}
                                </span>
                              </div>
                            )}
                          </div>
                          {/* 操作菜单（hover 才显示）；重命名态下隐藏避免冲突 */}
                          {!isRenaming && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                  // 阻止冒泡，否则会触发外层的 handleSelect
                                  onClick={e => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleStartRename(session.id, session.title);
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  重命名
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={e => {
                                    e.stopPropagation();
                                    void handleDelete(session.id);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
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
    </div>
  );
}
