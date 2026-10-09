import { cn } from '@/lib/utils';
import type { EmbeddingState } from '@shared/utils/embedding-state';

/** 环形进度的半径，和 14×14 的图形尺寸配套。 */
const RING_RADIUS = 5.5;

/** 环的周长，用来把完成比例换算成 dasharray。 */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 归到「需要处理」一类的状态：用琥珀色，其余用中性色。 */
const WARN_STATES: EmbeddingState[] = ['none'];

/** 角标文案，同时作为原生 tooltip 与无障碍标签。 */
const STATE_LABELS: Record<EmbeddingState, string> = {
  none: '未向量化：这本书还不能用于检索',
  done: '已向量化',
  queued: '排队等待中',
  running: '正在生成向量',
  paused: '已暂停',
};

interface BookIndexBadgeProps {
  state: EmbeddingState;
  /** 当前模型下的进度，向量化中时用来算百分比 */
  counts: { total: number; done: number };
  /** 现有向量不是当前模型生成的。角标空间小，用它把「未向量化」换成更准确的「待重建」 */
  stale: boolean;
  className?: string;
}

/**
 * 书籍卡片右上角的向量化状态：**文字在左、环形图标在右**，合成一个胶囊。
 *
 * 文字放这里而不是标题下面，是为了让卡片只占两行——书名一行、作者一行。
 * 状态本来就不是每本书都需要细看的信息，挤进正文区会让整屏书看起来太长。
 *
 * **环形图标只在向量化过程中出现。** 只有那时才有「进度」可言；其余状态挂一个
 * 静止的圆环会让人以为它还在动，所以那些状态只给一个词，颜色承担区分度。
 *
 * **底色一律不透明。** 这个胶囊压在书封上是任意一张图片，半透明的底会让封面透上来，
 * 文字在花哨的封面上根本读不出来。
 */
export function BookIndexBadge({ state, counts, stale, className }: BookIndexBadgeProps) {
  const isRunning = state === 'running';
  const isDone = state === 'done';
  const isWarn = WARN_STATES.includes(state);
  const ratio = counts.total === 0 ? 0 : counts.done / counts.total;
  const text = describeState(state, counts, stale);
  const label =
    stale && state === 'none'
      ? '待重建：现有向量不是当前模型生成的，重新向量化会先删掉它们'
      : STATE_LABELS[state];

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center gap-1 rounded-full border px-1.5 py-0.5',
        isWarn &&
          'border-amber-500/45 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
        isDone &&
          'border-emerald-600/35 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
        isRunning && 'border-primary/40 bg-background text-primary',
        !isRunning && !isDone && !isWarn && 'border-border bg-muted text-muted-foreground',
        className
      )}
    >
      <span className="text-[10px] leading-none whitespace-nowrap tabular-nums">{text}</span>
      {isRunning && <RingGlyph progress={ratio} />}
    </span>
  );
}

/** 胶囊里的文字。没有数字可给的状态就只写一句结论，不凑字数。 */
function describeState(
  state: EmbeddingState,
  counts: { total: number; done: number },
  stale: boolean
): string {
  const { total, done } = counts;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  switch (state) {
    case 'running':
      return `向量化中 ${percent}%`;
    case 'queued':
      return '排队中';
    case 'paused':
      return `已暂停 ${done}/${total}`;
    case 'done':
      return '已向量化';
    default:
      // 现有向量是别的模型生成的，「待重建」比「未向量化」有用得多
      if (stale) return '待重建';
      // 做了一半就带上百分比，状态本身不区分「没开始」和「做了一半」
      return total > 0 && done > 0 ? `未向量化 ${percent}%` : '未向量化';
  }
}

/** 环形进度：底环常显，进度环按比例填充。 */
function RingGlyph({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden>
      <circle
        className="text-border"
        cx="7"
        cy="7"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle
        className="text-primary"
        cx="7"
        cy="7"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray={`${clamped * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
