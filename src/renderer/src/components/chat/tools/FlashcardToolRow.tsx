import { ToolRowBase } from '@/components/chat/tools/ToolRowBase';
import {
  ACTION_META,
  buildDetail,
  FlashcardChangeBody,
} from '@/components/chat/tools/FlashcardChangeView';
import type { FlashcardChangeDetail } from '@shared/types/flashcards';

/**
 * 闪卡写入工具调用行：用富内容展示本次改动。
 * 只在工具成功返回、且详情能解析成改动记录时使用；
 * 运行中、失败、以及历史日志里没有详情的旧记录，都由调用方回退到通用工具行。
 */
export function FlashcardToolRow({ change }: { change: FlashcardChangeDetail }) {
  const { label, Icon } = ACTION_META[change.action];

  return (
    <div className="min-w-0">
      <ToolRowBase
        icon={<Icon className="size-3" />}
        completeLabel={label}
        isAnimating={false}
        detail={buildDetail(change)}
        expandable
      >
        <div className="overflow-hidden rounded-md border border-border bg-muted/30">
          <div className="bg-background">
            <FlashcardChangeBody change={change} />
          </div>
        </div>
      </ToolRowBase>
    </div>
  );
}
