import { memo } from 'react';
import type { Usage } from '@shared/types/chat';
import type { AppUIMessage } from '@/types/message';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** 参与合计的用量字段 */
type UsageField = keyof Usage;

/** 叠加 trace 内所有 assistant 消息的同一字段 */
function sumField(messages: AppUIMessage[], field: UsageField): number {
  return messages.reduce((sum, message) => sum + (message.usage?.[field] ?? 0), 0);
}

/** 千分位数字 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * 一条 trace 的 token 消耗统计：输入、输出、合计，hover 展开缓存命中与思考。
 * 由调用方保证只在该 trace 结束后渲染——用量要等请求结束才拿得到，运行中显示没有意义。
 */
export const TraceUsage = memo(function TraceUsage({ messages }: { messages: AppUIMessage[] }) {
  // 整条 trace 一条用量都没有（请求全失败、provider 未上报）时不显示统计
  if (!messages.some(message => message.usage)) return null;

  const input = sumField(messages, 'input');
  const output = sumField(messages, 'output');
  const total = sumField(messages, 'totalTokens');
  const cacheRead = sumField(messages, 'cacheRead');
  const reasoning = sumField(messages, 'reasoning');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-fit cursor-default items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-muted/60">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/55">输入</span>
            <span className="text-foreground/70">{formatNumber(input)}</span>
          </span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/55">输出</span>
            <span className="text-foreground/70">{formatNumber(output)}</span>
          </span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/55">合计</span>
            <span className="font-medium text-foreground/85">{formatNumber(total)}</span>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        <div className="flex flex-col gap-0.5">
          <span>缓存命中 {formatNumber(cacheRead)}</span>
          <span>思考 {formatNumber(reasoning)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
