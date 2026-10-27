import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, FilePenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '@/components/chat/markdown/Markdown';
import { useCardEditDialog } from '@/hooks/use-card-edit-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CardGroupSummary, CardRecord, CardReviewRating } from '@shared/types/flashcards';

/** 复习组件属性。 */
interface CardReviewProps {
  /** 牌组 ID；省略时复习全部牌组的今日队列。 */
  groupId?: string;
}

/** 按牌组或全部牌组执行 FSRS 复习的 Tab。 */
export function CardReview({ groupId }: CardReviewProps) {
  const [group, setGroup] = useState<CardGroupSummary | undefined>();
  const [queue, setQueue] = useState<CardRecord[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);

  /** 加载复习队列；带 groupId 时同时取牌组信息。 */
  const load = useCallback(async () => {
    setLoading(true);
    if (!groupId) {
      const queueResult = await window.api.getReviewQueue({});
      if (!queueResult.success) toast.error(queueResult.error ?? '加载复习队列失败');
      else setQueue(queueResult.cards ?? []);
      setLoading(false);
      return;
    }

    const [groupsResult, queueResult] = await Promise.all([
      window.api.listCardGroups(),
      window.api.getReviewQueue({ groupId }),
    ]);
    if (!groupsResult.success || !groupsResult.groups)
      toast.error(groupsResult.error ?? '加载牌组失败');
    else setGroup(groupsResult.groups.find(item => item.id === groupId));
    if (!queueResult.success) toast.error(queueResult.error ?? '加载复习队列失败');
    else setQueue(queueResult.cards ?? []);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const result = await window.api.getReviewQueue(groupId ? { groupId } : {});
        if (!result.success || !result.cards) return;
        setQueue(current => mergeReviewQueue(current, result.cards ?? []));
      })();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [groupId]);

  /** 提交当前卡片的 FSRS 评分并进入下一张。 */
  async function handleReview(rating: CardReviewRating) {
    const current = queue[0];
    if (!current || reviewing) return;
    setReviewing(true);
    const result = await window.api.reviewCard({ id: current.id, rating });
    setReviewing(false);
    if (!result.success) {
      toast.error(result.error ?? '保存复习结果失败');
      return;
    }
    window.dispatchEvent(new Event('flashcards:changed'));
    setQueue(items => items.slice(1));
    setShowAnswer(false);
  }

  /** 用编辑后的内容替换当前复习卡片。 */
  function handleCardSaved(card: CardRecord) {
    setQueue(items => items.map(item => (item.id === card.id ? card : item)));
    setShowAnswer(false);
  }

  const { openEditCard, cardEditDialog } = useCardEditDialog({ onSaved: handleCardSaved });

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-surface-1 text-sm text-muted-foreground">
        准备复习队列…
      </div>
    );
  if (groupId && !group)
    return (
      <div className="flex h-full items-center justify-center bg-surface-1 text-sm text-muted-foreground">
        牌组不存在。
      </div>
    );

  const current = queue[0];
  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-1 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <div className="flex items-center justify-between gap-4 border-b bg-background px-6 py-3">
        <h1 className="text-lg font-semibold">{groupId ? '复习' : '今日复习'}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">剩余 {queue.length} 张</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={!current}
            onClick={() => {
              if (current) openEditCard(current);
            }}
          >
            <FilePenLine />
            编辑
          </Button>
        </div>
      </div>
      <div className="flex flex-1 justify-center overflow-y-auto p-6">
        {!current ? (
          <ReviewComplete />
        ) : (
          <div className="m-auto flex w-full max-w-3xl flex-col gap-5">
            <Card>
              <CardContent className="min-h-64 px-7 py-8">
                <Markdown content={current.fields.front} />
              </CardContent>
            </Card>
            {showAnswer && (
              <Card className="border-primary-border bg-primary-surface">
                <CardContent className="px-7 py-8">
                  <Markdown content={current.fields.back} />
                </CardContent>
              </Card>
            )}
            {!showAnswer ? (
              <Button className="mx-auto flex" size="lg" onClick={() => setShowAnswer(true)}>
                <Eye />
                显示答案
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <RatingButton
                  label="重来"
                  tone="again"
                  onClick={() => void handleReview('again')}
                  disabled={reviewing}
                />
                <RatingButton
                  label="困难"
                  tone="hard"
                  onClick={() => void handleReview('hard')}
                  disabled={reviewing}
                />
                <RatingButton
                  label="良好"
                  tone="good"
                  onClick={() => void handleReview('good')}
                  disabled={reviewing}
                />
                <RatingButton
                  label="简单"
                  tone="easy"
                  onClick={() => void handleReview('easy')}
                  disabled={reviewing}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {cardEditDialog}
    </div>
  );
}

/** 复习完成状态。 */
function ReviewComplete() {
  return (
    <Card className="m-auto max-w-md border-dashed bg-card text-center">
      <CardContent className="flex flex-col items-center px-10 py-12">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-surface text-success-ink">
          <Check className="size-6" />
        </div>
        <h2 className="text-xl font-semibold">本轮复习完成</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          当前没有待学习或待复习的卡片。
        </p>
      </CardContent>
    </Card>
  );
}

/** 带有语义颜色的复习评分按钮。 */
function RatingButton({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  tone: 'again' | 'hard' | 'good' | 'easy';
  onClick: () => void;
  disabled: boolean;
}) {
  const toneClass = {
    again: 'border-danger-border bg-danger-surface text-danger-ink hover:border-danger-ink',
    hard: 'border-warn-border bg-warn-surface text-warn-ink hover:border-warn-ink',
    good: 'border-success-border bg-success-surface text-success-ink hover:border-success-ink',
    easy: 'border-info-border bg-info-surface text-info-ink hover:border-info-ink',
  }[tone];
  return (
    <button
      type="button"
      className={cn(
        'h-14 cursor-pointer rounded-lg border text-sm font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        toneClass
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

/** 将新到期卡片增量加入当前复习队列。 */
function mergeReviewQueue(current: CardRecord[], incoming: CardRecord[]): CardRecord[] {
  const currentIds = new Set(current.map(card => card.id));
  return [...current, ...incoming.filter(card => !currentIds.has(card.id))];
}
