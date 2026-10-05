import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, FilePenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '@/components/chat/markdown/Markdown';
import { useCardEditDialog } from '@/hooks/use-card-edit-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CardGroupSummary, CardRecord, CardReviewRating } from '@shared/types/flashcards';

/** 复习组件属性。 */
interface CardReviewProps {
  groupId?: string;
}

/** 按牌组执行 FSRS 复习的 Tab。 */
export function CardReview({ groupId }: CardReviewProps) {
  const [group, setGroup] = useState<CardGroupSummary | undefined>();
  const [queue, setQueue] = useState<CardRecord[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);

  /** 加载牌组信息和复习队列。 */
  const load = useCallback(async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
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
    if (!groupId) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const result = await window.api.getReviewQueue({ groupId });
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
      <div className="flex h-full items-center justify-center bg-muted/15 text-sm text-muted-foreground">
        准备复习队列…
      </div>
    );
  if (!group)
    return (
      <div className="flex h-full items-center justify-center bg-muted/15 text-sm text-muted-foreground">
        牌组不存在。
      </div>
    );

  const current = queue[0];
  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/15 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <div className="flex items-center justify-between gap-4 border-b bg-background/80 px-6 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">复习</h1>
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
            <Card className="shadow-sm">
              <CardContent className="min-h-64 px-7 py-8">
                <Markdown content={current.fields.front} />
              </CardContent>
            </Card>
            {showAnswer && (
              <Card className="border-primary/25 bg-primary/5 shadow-sm">
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
    <Card className="m-auto max-w-md border-dashed bg-background/70 text-center shadow-sm">
      <CardContent className="flex flex-col items-center px-10 py-12">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
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
    again:
      'border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900',
    hard: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900',
    good: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900',
    easy: 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900',
  }[tone];
  return (
    <Button
      variant="outline"
      className={`h-14 shadow-sm ${toneClass}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="font-semibold">{label}</span>
    </Button>
  );
}

/** 将新到期卡片增量加入当前复习队列。 */
function mergeReviewQueue(current: CardRecord[], incoming: CardRecord[]): CardRecord[] {
  const currentIds = new Set(current.map(card => card.id));
  return [...current, ...incoming.filter(card => !currentIds.has(card.id))];
}
