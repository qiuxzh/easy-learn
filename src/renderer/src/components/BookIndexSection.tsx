import { useState, type ReactNode } from 'react';
import { Loader2, Pause, Play, RotateCcw, Scissors, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { useBooksStore } from '@/stores/books-store';
import { useEmbeddingStore } from '@/stores/embedding-store';
import { cn } from '@/lib/utils';
import {
  describeEmbedding,
  isStale,
  resolveDisplayCounts,
  resolveEmbeddingState,
} from '@shared/utils/embedding-state';
import type { EmbeddingState } from '@shared/utils/embedding-state';

/** 节点语气，决定边框与文字配色。 */
type NodeTone = 'plain' | 'ok' | 'warn' | 'run' | 'off';

/** 向量化节点上的动作类型。 */
type NodeActionKind = 'start' | 'rebuild' | 'pause' | 'resume' | 'cancel';

/** 向量化节点上的一个动作。 */
interface NodeAction {
  label: string;
  variant: 'default' | 'outline';
  icon: ReactNode;
  kind: NodeActionKind;
  /** 需要二次确认时填确认类型，否则直接执行 */
  confirm?: 'rebuild';
}

/** 待确认的破坏性操作。 */
type PendingConfirm = { kind: 'rechunk' } | { kind: 'rebuild' };

interface BookIndexSectionProps {
  /** 所属书籍 id */
  bookId: string;
}

/**
 * 书籍详情里的「向量索引」分区。
 *
 * 用两个节点把处理链路画出来——分片、向量化——动作分别挂在对应节点上。
 * 这两步是单向依赖：重新分片会让已有向量全部失效，把按钮并排放在一起
 * 会让人以为它们可以随便点。
 *
 * 状态不来自后端：数据轴由「书籍自带的向量化信息 ＋ 当前配置算出的模型身份」推出，
 * 运行轴由主进程推送的运行态提供。所以换模型时不需要任何回写，界面立刻就是对的。
 */
export function BookIndexSection({ bookId }: BookIndexSectionProps) {
  const book = useBooksStore(state => state.books.find(item => item.id === bookId));
  const runtime = useEmbeddingStore(state => state.runtime);
  const current = useEmbeddingStore(state => state.current);
  const loadBooks = useBooksStore(state => state.loadBooks);

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  if (!book) return null;

  const embedding = book.embedding;
  const configured = current !== null;
  const state = resolveEmbeddingState(embedding, bookId, current, runtime);
  const counts = resolveDisplayCounts(embedding, bookId, current, runtime);
  const notes = describeEmbedding(embedding, current);
  const stale = isStale(embedding, current);

  /** 执行一次命令类调用，统一处理忙碌态与报错。 */
  async function run(
    action: () => Promise<{ success: boolean; error?: string }>
  ): Promise<boolean> {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? '操作失败');
      return false;
    }
    return true;
  }

  /** 开始 / 继续 / 重新向量化：同一个入口，只有模式不同。 */
  async function startEmbedding(mode: 'resume' | 'rebuild'): Promise<void> {
    await run(() => window.api.startEmbedding({ bookId, mode }));
  }

  /** 重新分片：重解析原文件、替换分片、清空该书的向量。 */
  async function handleRechunk(): Promise<void> {
    setBusy(true);
    const result = await window.api.rechunkBook(bookId);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? '重新分片失败');
      return;
    }
    toast.success(`已重新切分为 ${result.total ?? 0} 个分片`);
    void loadBooks();
  }

  /** 按动作类型分派。需要确认的先弹确认框。 */
  function handleAction(action: NodeAction): void {
    if (action.confirm) {
      setConfirm({ kind: action.confirm });
      return;
    }
    switch (action.kind) {
      case 'start':
        void startEmbedding('resume');
        return;
      case 'rebuild':
        void startEmbedding('rebuild');
        return;
      case 'pause':
        void run(() => window.api.pauseEmbedding());
        return;
      case 'resume':
        void run(() => window.api.resumeEmbedding());
        return;
      case 'cancel':
        void run(() => window.api.cancelEmbedding());
        return;
    }
  }

  async function handleConfirm(): Promise<void> {
    const pending = confirm;
    setConfirm(null);
    if (!pending) return;
    if (pending.kind === 'rechunk') await handleRechunk();
    else await startEmbedding('rebuild');
  }

  const nodes = buildNodes({ state, counts, configured, notes, stale });

  return (
    <div className="flex flex-col border-t border-border pt-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">向量索引</span>
      </div>

      <div className="flex flex-col">
        <FlowNode
          index={1}
          name="分片"
          tone={nodes.split.tone}
          stateText={nodes.split.stateText}
          body={nodes.split.body}
          hint={nodes.split.hint}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || nodes.split.locked}
            onClick={() => setConfirm({ kind: 'rechunk' })}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Scissors />}
            重新分片
          </Button>
        </FlowNode>

        <div className="flex justify-center py-[3px]">
          <svg
            width="14"
            height="26"
            viewBox="0 0 14 26"
            className={cn(nodes.active ? 'text-primary' : 'text-muted-foreground/45')}
            aria-hidden
          >
            <line x1="7" y1="0" x2="7" y2="17" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.5 17 L7 25 L11.5 17 Z" fill="currentColor" />
          </svg>
        </div>

        <FlowNode
          index={2}
          name="向量化"
          tone={nodes.embed.tone}
          stateText={nodes.embed.stateText}
          body={nodes.embed.body}
          hint={nodes.embed.hint}
          progress={nodes.embed.progress}
        >
          {nodes.embed.actions.map(action => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant}
              size="sm"
              disabled={busy}
              onClick={() => handleAction(action)}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </FlowNode>
      </div>

      <p className="mt-2.5 rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {nodes.note}
      </p>

      <ConfirmDialogs
        pending={confirm}
        onOpenChange={open => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
}

/** 流程节点：编号 + 名称 + 状态 + 进度条 + 正文 + 动作。 */
function FlowNode({
  index,
  name,
  tone,
  stateText,
  body,
  hint,
  progress,
  children,
}: {
  index: number;
  name: string;
  tone: NodeTone;
  stateText: string;
  body: string;
  hint?: string;
  /** 有值时显示进度条，0~1 */
  progress?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5',
        tone === 'ok' && 'border-emerald-600/40 bg-emerald-600/5',
        tone === 'warn' && 'border-amber-500/45 bg-amber-500/10',
        tone === 'run' && 'border-primary/45 bg-primary/5',
        tone === 'plain' && 'border-border',
        tone === 'off' && 'border-border opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-border text-[10px] text-muted-foreground">
          {index}
        </span>
        <span className="text-xs font-semibold">{name}</span>
        <span
          className={cn(
            'ml-auto whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground',
            tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'warn' && 'text-amber-600 dark:text-amber-400',
            tone === 'run' && 'text-foreground'
          )}
        >
          {stateText}
        </span>
      </div>

      {progress !== undefined && (
        <div
          className={cn(
            'mt-1.5 h-1.5 overflow-hidden rounded-full',
            tone === 'warn' ? 'bg-amber-500/20' : 'bg-muted'
          )}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              tone === 'warn' ? 'bg-amber-500' : 'bg-primary'
            )}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
          />
        </div>
      )}

      <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">{body}</div>

      {(hint || children) && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {hint && (
            <span className="mr-auto truncate text-[10.5px] tabular-nums text-muted-foreground">
              {hint}
            </span>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/** 两个节点各自要显示的内容，由展示状态推出来。 */
function buildNodes(input: {
  state: EmbeddingState;
  counts: { total: number; done: number };
  configured: boolean;
  notes: string[];
  stale: boolean;
}): {
  active: boolean;
  split: { tone: NodeTone; stateText: string; body: string; hint?: string; locked: boolean };
  embed: {
    tone: NodeTone;
    stateText: string;
    body: string;
    hint?: string;
    progress?: number;
    actions: NodeAction[];
  };
  note: string;
} {
  const { state, counts, configured, notes, stale } = input;
  const { total, done } = counts;
  const ratio = total === 0 ? 0 : done / total;
  const active = state === 'running' || state === 'paused' || state === 'queued';

  const hasChunks = total > 0;
  const split = {
    tone: (hasChunks ? 'ok' : 'warn') as NodeTone,
    stateText: hasChunks ? '✓ 已完成' : '⚠ 未完成',
    body: hasChunks ? `${total} 个分片 · 已就绪` : '0 个分片 · 需要先重新分片',
    hint: active ? '向量化进行中，暂时不能重新分片' : undefined,
    locked: active,
  };

  let embed: {
    tone: NodeTone;
    stateText: string;
    body: string;
    hint?: string;
    progress?: number;
    actions: NodeAction[];
  };

  if (!hasChunks) {
    embed = { tone: 'off', stateText: '不可用', body: '缺少输入', actions: [] };
  } else if (!configured) {
    embed = {
      tone: 'off',
      stateText: '不可用',
      body: '尚未选择向量模型',
      hint: '请先到设置页添加并选中一个模型',
      actions: [],
    };
  } else if (state === 'running') {
    embed = {
      tone: 'run',
      stateText: `${Math.round(ratio * 100)}%`,
      body: `${done} / ${total}`,
      progress: ratio,
      actions: [{ label: '暂停', variant: 'outline', icon: <Pause />, kind: 'pause' }],
    };
  } else if (state === 'queued') {
    embed = { tone: 'plain', stateText: '排队中', body: '等待前一个任务完成', actions: [] };
  } else if (state === 'paused') {
    embed = {
      tone: 'run',
      stateText: '已暂停',
      body: `${done} / ${total}`,
      progress: ratio,
      actions: [
        { label: '继续', variant: 'default', icon: <Play />, kind: 'resume' },
        { label: '取消', variant: 'outline', icon: <X />, kind: 'cancel' },
      ],
    };
  } else if (state === 'done') {
    embed = {
      tone: 'ok',
      stateText: '✓ 已向量化',
      body: `${done} / ${total}`,
      actions: [
        {
          label: '重新向量化',
          variant: 'outline',
          icon: <RotateCcw />,
          kind: 'rebuild',
          confirm: 'rebuild',
        },
      ],
    };
  } else {
    // 未向量化：从没做过、做了一半、换了模型、上次失败，都在这里。
    // 动作完全一样——重新向量化会先把现有向量删掉，那一点写在正文里。
    embed = {
      tone: notes.length > 0 ? 'warn' : 'plain',
      // 现有向量是别的模型生成的，「待重建」比「未开始」有用得多
      stateText: stale ? '⚠ 待重建' : done > 0 ? `未完成 ${Math.round(ratio * 100)}%` : '未开始',
      body: `${done} / ${total}`,
      progress: done > 0 ? ratio : undefined,
      actions: [
        {
          label: done > 0 ? '继续向量化' : '开始向量化',
          variant: 'default',
          icon: <Play />,
          kind: 'start',
        },
      ],
    };
  }

  return { active, split, embed, note: buildNote(state, counts, configured, notes) };
}

/** 节点下方的说明文字，随状态变化。 */
function buildNote(
  state: EmbeddingState,
  counts: { total: number; done: number },
  configured: boolean,
  notes: string[]
): string {
  if (state === 'running') {
    return '正在请求向量服务。关闭本弹窗不会中断任务，可以随时回来查看。';
  }
  if (state === 'paused') {
    return '已停在批次边界。已经写好的向量不会重做，点「继续」接着往下做。';
  }
  if (state === 'queued') {
    return '一次只跑一本书，轮到它时会自动开始。';
  }
  if (!configured) {
    return '还没有选中向量模型，无从判断现有的向量算不算数。到设置页添加并选中一个模型后，这里会显示这本书的索引状态。';
  }
  if (state === 'none' && notes.length > 0) {
    return `这本书还不能用于检索。${notes.join('；')}。`;
  }
  if (state === 'none' && counts.done > 0) {
    return `已完成 ${counts.done} 个分片，继续会从没做成的部分接着做。`;
  }
  return '分片把正文切成可检索的小块，向量化再把这些小块转成可以按语义检索的向量。第二步依赖第一步：重新分片会让已有向量全部失效。';
}

/** 两种破坏性操作的确认弹窗。 */
function ConfirmDialogs({
  pending,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingConfirm | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;

  if (pending.kind === 'rechunk') {
    return (
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新分片</AlertDialogTitle>
            <AlertDialogDescription>
              会按当前规则重新切分正文。分片换了之后，
              <b>这本书的向量会被清空</b>，已经花掉的额度不会退回。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              重新分片
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>重新生成向量</AlertDialogTitle>
          <AlertDialogDescription>
            会用当前选中的模型把这本书重新向量化一遍。
            <b>这本书现有的向量会被删掉</b>——同一本书只保留一份向量数据。确定要继续吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>稍后</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>开始重建</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
