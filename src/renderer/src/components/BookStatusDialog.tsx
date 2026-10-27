import { Fragment, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, ScanText, Scissors, Square, X } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBooksStore } from '@/stores/books-store';
import { useEmbeddingStore } from '@/stores/embedding-store';
import { useOcrStore } from '@/stores/ocr-store';
import { cn } from '@/lib/utils';
import {
  describeEmbedding,
  isStale,
  resolveDisplayCounts,
  resolveEmbeddingState,
  toEmbedding,
} from '@shared/utils/embedding-state';
import type { BookDoc, BookStageInfo } from '@shared/types/books';
import type { OcrRuntime } from '@shared/types/ocr';

/** 节点语气，决定边框与文字配色。 */
type NodeTone = 'plain' | 'ok' | 'warn' | 'run' | 'off';

/** 节点上的动作类型。 */
type NodeActionKind =
  | 'ocr'
  | 'ocrCancel'
  | 'rechunk'
  | 'start'
  | 'rebuild'
  | 'pause'
  | 'resume'
  | 'cancel';

/** 节点上的一个动作。 */
interface NodeAction {
  label: string;
  variant: 'solid' | 'outline';
  icon: ReactNode;
  kind: NodeActionKind;
  /** 需要二次确认时填确认类型，否则直接执行 */
  confirm?: 'rechunk' | 'rebuild' | 'ocrRestart';
  /** 暂时不可点：例如向量化进行中不能重新分片 */
  disabled?: boolean;
}

/** 待确认的破坏性操作。 */
type PendingConfirm = { kind: 'rechunk' } | { kind: 'rebuild' } | { kind: 'ocrRestart' };

/** 流程上的一个节点。 */
interface NodeView {
  key: string;
  name: string;
  tone: NodeTone;
  stateText: string;
  body: string;
  hint?: string;
  /** 有值时显示进度条，0~1 */
  progress?: number;
  actions: NodeAction[];
}

/** 书籍状态弹窗属性 */
interface BookStatusDialogProps {
  /** 要查看的书籍（列表刷新后会换成最新快照） */
  book: BookDoc;
  /** 关闭弹窗回调 */
  onOpenChange: (open: boolean) => void;
}

/**
 * 单本书的书籍状态弹窗：把提取文字、分片、向量化画成一条链，动作挂在对应节点上。
 *
 * 与详情弹窗分开，是因为两者生命周期不同：详情是书本身的事实，这里是可以重做、
 * 会互相失效、会随配置变化的派生数据。
 *
 * 不适用的阶段直接不渲染——EPUB 没有提取文字，给它一个永远无用的节点只是噪音。
 *
 * 状态不来自后端：数据轴由阶段行加当前配置算出的模型身份推出，运行轴由主进程推送的
 * 运行态提供。所以换模型时不需要任何回写，界面立刻就是对的。
 */
export function BookStatusDialog({ book, onOpenChange }: BookStatusDialogProps) {
  const live = useBooksStore(state => state.books.find(item => item.id === book.id)) ?? book;
  const runtime = useEmbeddingStore(state => state.runtime);
  const current = useEmbeddingStore(state => state.current);
  const ocrRuntime = useOcrStore(state => state.runtime);
  const loadBooks = useBooksStore(state => state.loadBooks);

  /** 只有正在跑这本书时才算「这本书的运行态」 */
  const activeOcr = ocrRuntime?.bookId === live.id ? ocrRuntime : null;

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const embedding = toEmbedding(live.stages.embed);
  const configured = current !== null;
  const state = resolveEmbeddingState(embedding, live.id, current, runtime);
  const counts = resolveDisplayCounts(embedding, live.id, current, runtime);
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
    await run(() => window.api.startEmbedding({ bookId: live.id, mode }));
  }

  /** 重新分片：重解析原文件、替换分片、清空该书的向量。 */
  async function handleRechunk(): Promise<void> {
    setBusy(true);
    const result = await window.api.rechunkBook(live.id);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? '重新分片失败');
      return;
    }
    toast.success(`已重新切分为 ${result.total ?? 0} 个分片`);
    void loadBooks();
  }

  /** 开始 / 继续 / 重新提取文字。`restart` 会先清掉旧结果。 */
  async function startOcr(restart: boolean): Promise<void> {
    const ok = await run(() => window.api.startOcr(live.id, restart));
    if (ok) toast.info(restart ? '已开始重新提取' : '已开始提取文字');
  }

  /** 按动作类型分派。需要确认的先弹确认框。 */
  function handleAction(action: NodeAction): void {
    if (action.confirm) {
      setConfirm({ kind: action.confirm });
      return;
    }
    switch (action.kind) {
      case 'ocr':
        void startOcr(false);
        return;
      case 'ocrCancel':
        void run(() => window.api.cancelOcr());
        return;
      case 'rechunk':
        setConfirm({ kind: 'rechunk' });
        return;
      case 'start':
        void startEmbedding('resume');
        return;
      case 'rebuild':
        void startEmbedding('rebuild');
        return;
      case 'pause':
        void run(() => window.api.pauseEmbedding(live.id));
        return;
      case 'resume':
        void run(() => window.api.resumeEmbedding(live.id));
        return;
      case 'cancel':
        void run(() => window.api.cancelEmbedding(live.id));
        return;
    }
  }

  async function handleConfirm(): Promise<void> {
    const pending = confirm;
    setConfirm(null);
    if (!pending) return;
    if (pending.kind === 'rechunk') await handleRechunk();
    else if (pending.kind === 'ocrRestart') await startOcr(true);
    else await startEmbedding('rebuild');
  }

  const chain = buildChain({
    book: live,
    counts,
    state,
    stale,
    notes,
    configured,
    ocrRuntime: activeOcr,
  });

  // 扫描版（或文本层读不出来）且还没有分片的书：不能检索，且下一步必须是提取文字
  const ocr = live.stages.ocr;
  const chunkTotal = live.stages.chunk?.total ?? 0;
  const needsOcr =
    !activeOcr && ocr !== undefined && (ocr.done ?? 0) < (ocr.total ?? 1) && !chunkTotal;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-lg flex-col">
          <ScrollArea className="scroll-area-fit min-h-0 flex-1">
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>书籍状态</DialogTitle>
                <DialogDescription>
                  《{live.booksName}》· {live.booksType.toUpperCase()}
                </DialogDescription>
              </DialogHeader>

              {needsOcr && <OcrWarning ocr={ocr} />}

              <div className="flex flex-col">
                {chain.nodes.map((node, index) => (
                  <Fragment key={node.key}>
                    {index > 0 && <ChainArrow active={chain.nodes[index - 1].tone === 'ok'} />}
                    <FlowNode
                      index={index + 1}
                      name={node.name}
                      tone={node.tone}
                      stateText={node.stateText}
                      body={node.body}
                      hint={node.hint}
                      progress={node.progress}
                    >
                      {node.actions.map(action => (
                        <Button
                          key={action.label}
                          type="button"
                          variant={action.variant}
                          size="sm"
                          disabled={busy || action.disabled}
                          onClick={() => handleAction(action)}
                        >
                          {action.icon}
                          {action.label}
                        </Button>
                      ))}
                    </FlowNode>
                  </Fragment>
                ))}
              </div>

              <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {chain.note}
              </p>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialogs
        pending={confirm}
        onOpenChange={open => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}

/**
 * 扫描版的警告：这本书没有可直接读取的文字，提取之前既不能分片也不能检索。
 */
function OcrWarning({ ocr }: { ocr: BookStageInfo }) {
  return (
    <div className="rounded-lg border border-warn-border bg-warn-surface px-3 py-2.5 text-xs leading-relaxed text-warn-ink">
      <p className="font-medium">扫描版书籍还不能用于检索</p>
      <p className="mt-1">
        {ocr.lastError
          ? `文本层读取失败：${ocr.lastError}`
          : `没有可直接读取的文字，需要先提取文字${ocr.total ? `（共 ${ocr.total} 页）` : ''}。`}
      </p>
      <p className="mt-1">提取完成后会自动分片，这本书就能被检索。</p>
    </div>
  );
}

/** 节点之间的箭头；上一节点完成时点亮，表示这条链已经走到这里。 */
function ChainArrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-[3px]">
      <svg
        width="14"
        height="26"
        viewBox="0 0 14 26"
        className={cn(active ? 'text-primary' : 'text-ink-caption')}
        aria-hidden
      >
        <line x1="7" y1="0" x2="7" y2="17" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 17 L7 25 L11.5 17 Z" fill="currentColor" />
      </svg>
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
  progress?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5',
        tone === 'ok' && 'border-success-border bg-success-surface',
        tone === 'warn' && 'border-warn-border bg-warn-surface',
        tone === 'run' && 'border-primary-border bg-primary-surface',
        tone === 'plain' && 'border-stroke-3',
        tone === 'off' && 'border-stroke-3 opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-stroke-3 text-xs text-muted-foreground">
          {index}
        </span>
        <span className="text-xs font-semibold">{name}</span>
        <span
          className={cn(
            'ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground',
            tone === 'ok' && 'text-success-ink',
            tone === 'warn' && 'text-warn-ink',
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
            tone === 'warn' ? 'bg-warn-surface' : 'bg-muted'
          )}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              tone === 'warn' ? 'bg-warn-ink' : 'bg-primary'
            )}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
          />
        </div>
      )}

      <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">{body}</div>

      {(hint || children) && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {hint && (
            <span className="mr-auto truncate text-xs tabular-nums text-muted-foreground">
              {hint}
            </span>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/** 各节点要显示的内容，由阶段行与展示状态推出来。 */
function buildChain(input: {
  book: BookDoc;
  counts: { total: number; done: number };
  state: ReturnType<typeof resolveEmbeddingState>;
  stale: boolean;
  notes: string[];
  configured: boolean;
  ocrRuntime: OcrRuntime | null;
}): { nodes: NodeView[]; note: string } {
  const { book, counts, state, stale, notes, configured, ocrRuntime } = input;
  const { total, done } = counts;
  const active = state === 'running' || state === 'paused';
  const nodes: NodeView[] = [];

  // PDF 永远有提取文字阶段：有文本层时它显示「无需提取」，而不是整段消失
  const ocr = book.stages.ocr;
  if (book.booksType === 'pdf') {
    nodes.push({ key: 'ocr', name: '提取文字', ...buildOcrNode(ocr, ocrRuntime) });
  }

  const chunk = book.stages.chunk;
  const chunkTotal = chunk?.total ?? null;
  const ocrDone = ocr ? ocr.total !== null && (ocr.done ?? 0) >= ocr.total : true;

  nodes.push({
    key: 'chunk',
    name: '分片',
    ...buildChunkNode(chunkTotal, ocrDone, active, book.booksType === 'epub'),
  });

  nodes.push({
    key: 'embed',
    name: '向量化',
    ...buildEmbedNode({ total, done, state, stale, notes, configured }),
  });

  return { nodes, note: buildNote(state, counts, configured, notes) };
}

/**
 * 提取文字节点。
 *
 * 运行态优先于阶段行：服务端已经处理了多少页只有运行态知道，
 * 阶段行要等整块落库才会动。
 */
function buildOcrNode(
  ocr: BookStageInfo | undefined,
  runtime: OcrRuntime | null
): Pick<NodeView, 'tone' | 'stateText' | 'body' | 'hint' | 'progress' | 'actions'> {
  if (runtime) {
    const total = runtime.total || ocr?.total || 0;
    return {
      tone: 'run',
      stateText: runtime.phase === 'cancelling' ? '正在停止' : '提取中',
      body: total ? `${runtime.extracted} / ${total} 页` : '正在准备…',
      progress: total ? runtime.extracted / total : undefined,
      hint: runtime.phase === 'cancelling' ? '当前块跑完就停，已完成的页会保留' : undefined,
      actions: runtime.phase === 'running' ? [CANCEL_OCR_ACTION] : [],
    };
  }

  // 有文本层时 total 为 0；更早导入的书可能整行都没有，同样按「无需提取」显示
  if (!ocr || ocr.total === 0) {
    return {
      tone: 'ok',
      stateText: '无需提取',
      body: '这本书有文本层，不需要提取',
      actions: [],
    };
  }

  if (ocr.total === null) {
    return {
      tone: 'warn',
      stateText: '待提取',
      body: ocr.lastError ?? '这本书还没有可检索的文字',
      actions: [START_OCR_ACTION],
    };
  }

  const done = ocr.done ?? 0;
  if (done >= ocr.total) {
    return {
      tone: 'ok',
      stateText: '✓ 已完成',
      body: `${done} / ${ocr.total} 页`,
      actions: [RESTART_OCR_ACTION],
    };
  }

  return {
    tone: 'warn',
    stateText: `${done} / ${ocr.total}`,
    // 上一轮失败时把原因带出来，否则用户只看到进度停在原处
    body: ocr.lastError ?? `${done} / ${ocr.total} 页`,
    progress: done / ocr.total,
    actions: [START_OCR_ACTION],
  };
}

/** 开始 / 继续提取。中断过的书会从没做的块接着来。 */
const START_OCR_ACTION: NodeAction = {
  label: '开始提取',
  variant: 'solid',
  icon: <ScanText />,
  kind: 'ocr',
};

/** 重新提取：清掉旧结果与下游分片、向量，需要二次确认。 */
const RESTART_OCR_ACTION: NodeAction = {
  label: '重新提取',
  variant: 'outline',
  icon: <RotateCcw />,
  kind: 'ocr',
  confirm: 'ocrRestart',
};

/** 停止：只在块边界生效，服务端任务停不掉。 */
const CANCEL_OCR_ACTION: NodeAction = {
  label: '停止',
  variant: 'outline',
  icon: <Square />,
  kind: 'ocrCancel',
};

/** 分片节点：提取没完成时不能分片；重新分片目前只有 EPUB 支持。 */
function buildChunkNode(
  chunkTotal: number | null,
  ocrDone: boolean,
  active: boolean,
  canRechunk: boolean
): Pick<NodeView, 'tone' | 'stateText' | 'body' | 'hint' | 'actions'> {
  const rechunkAction: NodeAction[] = canRechunk
    ? [
        {
          label: '重新分片',
          variant: 'outline',
          icon: <Scissors />,
          kind: 'rechunk',
          confirm: 'rechunk',
          disabled: active,
        },
      ]
    : [];

  if (!ocrDone) {
    return {
      tone: 'off',
      stateText: '等待提取',
      body: '提取文字后才能分片',
      actions: [],
    };
  }

  if (chunkTotal === null || chunkTotal === 0) {
    return {
      tone: 'warn',
      stateText: '未完成',
      body: '还没有可检索的正文分片',
      hint: active ? '向量化进行中，暂时不能重新分片' : undefined,
      actions: rechunkAction,
    };
  }

  return {
    tone: 'ok',
    stateText: '✓ 已完成',
    body: `${chunkTotal} 个分片 · 已就绪`,
    hint: active ? '向量化进行中，暂时不能重新分片' : undefined,
    actions: rechunkAction,
  };
}

/** 向量化节点：状态最多，动作由状态决定。 */
function buildEmbedNode(input: {
  total: number;
  done: number;
  state: ReturnType<typeof resolveEmbeddingState>;
  stale: boolean;
  notes: string[];
  configured: boolean;
}): Pick<NodeView, 'tone' | 'stateText' | 'body' | 'hint' | 'progress' | 'actions'> {
  const { total, done, state, stale, notes, configured } = input;
  const ratio = total === 0 ? 0 : done / total;

  if (total === 0) {
    return { tone: 'off', stateText: '不可用', body: '缺少输入', actions: [] };
  }
  if (!configured) {
    return {
      tone: 'off',
      stateText: '不可用',
      body: '尚未选择向量模型',
      hint: '请先到设置页添加并选中一个模型',
      actions: [],
    };
  }
  if (state === 'running') {
    return {
      tone: 'run',
      stateText: `${Math.round(ratio * 100)}%`,
      body: `${done} / ${total}`,
      progress: ratio,
      actions: [{ label: '暂停', variant: 'outline', icon: <Pause />, kind: 'pause' }],
    };
  }
  if (state === 'paused') {
    return {
      tone: 'run',
      stateText: '已暂停',
      body: `${done} / ${total}`,
      progress: ratio,
      actions: [
        { label: '继续', variant: 'solid', icon: <Play />, kind: 'resume' },
        { label: '取消', variant: 'outline', icon: <X />, kind: 'cancel' },
      ],
    };
  }
  if (state === 'done') {
    return {
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
  }

  // 未向量化：从没做过、做了一半、换了模型、上次失败，都在这里。动作完全一样。
  return {
    tone: notes.length > 0 ? 'warn' : 'plain',
    stateText: stale ? '⚠ 待重建' : done > 0 ? `未完成 ${Math.round(ratio * 100)}%` : '未开始',
    body: `${done} / ${total}`,
    progress: done > 0 ? ratio : undefined,
    actions: [
      {
        label: done > 0 ? '继续向量化' : '开始向量化',
        variant: 'solid',
        icon: <Play />,
        kind: 'start',
      },
    ],
  };
}

/** 节点下方的说明文字，随状态变化。 */
function buildNote(
  state: ReturnType<typeof resolveEmbeddingState>,
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive-hover"
            >
              重新分片
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (pending.kind === 'ocrRestart') {
    return (
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新提取文字</AlertDialogTitle>
            <AlertDialogDescription>
              会重新识别整本书。现有的识别结果、插图、分片都会删除，
              <b>这本书的向量也会被清空</b>，已经花掉的额度不会退回。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive-hover"
            >
              重新提取
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
