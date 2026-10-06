import { memo, useMemo, type ReactNode } from 'react';
import { IconTool } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/chat/markdown/Markdown';
import { ToolRowBase } from '../tools/ToolRowBase';
import { FlashcardToolRow } from '@/components/chat/tools/FlashcardToolRow';
import { TOOL_PRESENTATION } from '@/components/chat/tools/tool-presentation';
import {
  isFlashcardWriteTool,
  parseFlashcardChange,
} from '@/components/chat/tools/FlashcardChangeView';
import { ReasoningBlock } from './ReasoningBlock';
import {
  isAbortPart,
  isErrorPart,
  isReasoningPart,
  isTextPart,
  isToolCallPart,
  isToolResultPart,
} from './utils';
import type {
  AppErrorPart,
  AppToolCallPart,
  AppToolResultPart,
  AppUIMessage,
} from '@/types/message';

const TOOL_RESULT_MAX_PREVIEW = 400;

/** 尝试将字符串解析为 JSON，失败返回 null */
function tryParseJson(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 等宽正文：能解析成 JSON 就格式化，否则原样 */
function toMonoText(raw: string): string {
  const parsed = tryParseJson(raw);
  return parsed === null ? raw : JSON.stringify(parsed, null, 2);
}

/** 行摘要的最大字符数，超长时截断避免撑爆单行。 */
const MAX_SUMMARY_LENGTH = 80;

/**
 * 读取入参里被显式声明的那个字段作为行摘要。
 * 字段缺失或不是字符串时返回 undefined——不做任何猜测，宁可没有摘要。
 */
function readSummaryField(raw: string, field: string): string | undefined {
  const parsed = tryParseJson(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const value = (parsed as Record<string, unknown>)[field];
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH)}…` : text;
}

/** 用户主动中止时显示的提示 */
function AbortNotice() {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-muted-foreground/20 bg-muted/40 px-2.5 py-1 text-[12px] text-muted-foreground">
      <span>输出已停止</span>
    </div>
  );
}

/** 流式响应发生错误时显示的提示 */
function ErrorNotice({ part }: { part: AppErrorPart }) {
  return (
    <div className="w-fit max-w-full rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-destructive">
      {part.errorText}
    </div>
  );
}

/** 工具输出正文：超长截断，其余按 JSON 格式化 */
function toOutputText(result: AppToolResultPart): string {
  if (result.output.length > TOOL_RESULT_MAX_PREVIEW) {
    return `${result.output.slice(0, TOOL_RESULT_MAX_PREVIEW)}\n…`;
  }
  return toMonoText(result.output);
}

/**
 * 工具调用 + 工具结果合并成一行：
 * 标题与摘要都取自渲染层的展示表，未登记的工具回退显示原始工具名；
 * 展开后是等宽正文（上为入参、下为输出）。
 */
function ToolCallRow({
  toolCall,
  toolResult,
}: {
  toolCall: AppToolCallPart;
  toolResult?: AppToolResultPart;
}) {
  const isPending = !toolResult;
  const isError = toolResult ? !toolResult.success : false;
  const inputText = toMonoText(toolCall.input);
  // 标题与摘要都来自展示表；未登记的工具只显示原始工具名，不显示摘要
  const presentation = TOOL_PRESENTATION[toolCall.toolName];
  const label = presentation?.label ?? toolCall.toolName;
  const detail = presentation?.summaryFrom
    ? readSummaryField(toolCall.input, presentation.summaryFrom)
    : undefined;

  return (
    // min-w-0 避免 flex item 默认 min-width: auto 在父容器被压窄时把行撑成不可收缩
    <div className="min-w-0">
      <ToolRowBase
        icon={<IconTool className="size-3" />}
        shimmerLabel={label}
        completeLabel={label}
        isAnimating={isPending}
        detail={detail}
        trailingContent={
          isError ? <span className="shrink-0 text-destructive">error</span> : undefined
        }
        expandable
      >
        <div className="overflow-hidden rounded-md border border-border bg-muted/30">
          {inputText && (
            <div className="border-b border-border px-2.5 py-1.5">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-[16px]">
                {inputText}
              </pre>
            </div>
          )}
          <div className="bg-background px-2.5 py-1.5">
            {isPending ? (
              <span className="font-mono text-[12px] leading-[16px] text-muted-foreground">
                等待工具输出…
              </span>
            ) : (
              <pre
                className={cn(
                  'max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-[16px]',
                  isError && 'text-destructive'
                )}
              >
                {isError ? toolResult.output : toOutputText(toolResult)}
              </pre>
            )}
          </div>
        </div>
      </ToolRowBase>
    </div>
  );
}

/**
 * 按工具类型选择渲染方式：闪卡写入工具用富内容展示改动，
 * 其余情况（含运行中、失败、以及旧日志里没有 details 的记录）走通用工具行。
 */
function renderToolRow(key: string, toolCall: AppToolCallPart, toolResult?: AppToolResultPart) {
  const change =
    toolResult && isFlashcardWriteTool(toolCall.toolName)
      ? parseFlashcardChange(toolResult.details)
      : null;

  return change ? (
    <FlashcardToolRow key={key} change={change} />
  ) : (
    <ToolCallRow key={key} toolCall={toolCall} toolResult={toolResult} />
  );
}

/** 渲染一条 assistant 消息中的所有 parts */
export const AssistantParts = memo(function AssistantParts({ msg }: { msg: AppUIMessage }) {
  const elements = useMemo(() => {
    // 预构建 callId → tool-result 映射，避免重复匹配
    const resultByCallId = new Map<string, AppToolResultPart>();
    for (const part of msg.parts) {
      if (isToolResultPart(part)) {
        resultByCallId.set(part.toolCallId, part);
      }
    }

    // 跟踪已经被 tool-call 关联过的 result，避免与下方 tool-result 分支重复渲染
    const consumedResults = new Set<string>();

    const elems: ReactNode[] = [];
    msg.parts.forEach((part, index) => {
      const key = `${msg.id}-part-${index}`;

      if (isTextPart(part)) {
        if (!part.text) return;
        elems.push(
          <div key={key} className="group/assistant-text text-[15px]">
            <Markdown
              content={part.text}
              className="leading-relaxed [&_p]:leading-relaxed"
              isStreaming={part.state === 'streaming'}
            />
          </div>
        );
        return;
      }

      if (isReasoningPart(part)) {
        elems.push(<ReasoningBlock key={key} part={part} />);
        return;
      }

      if (isToolCallPart(part)) {
        const toolResult = resultByCallId.get(part.toolCallId);
        if (toolResult) consumedResults.add(part.toolCallId);
        elems.push(renderToolRow(key, part, toolResult));
        return;
      }

      if (isToolResultPart(part)) {
        // 已被对应 tool-call 渲染过则跳过
        if (consumedResults.has(part.toolCallId)) return;
        // 孤儿 result（缺少对应 tool-call）：用占位 call 渲染
        elems.push(
          renderToolRow(
            key,
            {
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            },
            part
          )
        );
        return;
      }

      if (isAbortPart(part)) {
        elems.push(<AbortNotice key={key} />);
        return;
      }

      if (isErrorPart(part)) {
        elems.push(<ErrorNotice key={key} part={part} />);
        return;
      }
    });

    return elems;
  }, [msg]);

  if (elements.length === 0) return null;

  return <div className="group/assistant-turn flex min-w-0 flex-col gap-3">{elements}</div>;
});
