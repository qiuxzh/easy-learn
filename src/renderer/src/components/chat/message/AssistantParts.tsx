import { memo, useMemo, type ReactNode } from 'react';
import { IconTool } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/chat/markdown/Markdown';
import { ToolRowBase } from '../tools/ToolRowBase';
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

/** 从工具入参里挑一段能一眼看懂的一行摘要，作为工具行的 detail */
function summarizeToolInput(raw: string): string | undefined {
  const parsed = tryParseJson(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const preferred = [
    'command',
    'file_path',
    'filePath',
    'path',
    'pattern',
    'query',
    'url',
    'prompt',
    'description',
  ];
  const key =
    preferred.find(k => typeof record[k] === 'string') ??
    Object.keys(record).find(k => typeof record[k] === 'string');
  if (!key) return undefined;
  const value = String(record[key]).replace(/\s+/g, ' ').trim();
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
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
 * 运行中标签流光，右侧是"工具名 · 入参摘要"；
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
  // 行上只写"调用工具"，具体是哪个工具放在 detail 里
  const summary = summarizeToolInput(toolCall.input);
  const detail = summary ? `${toolCall.toolName} · ${summary}` : toolCall.toolName;

  return (
    // min-w-0 避免 flex item 默认 min-width: auto 在父容器被压窄时把行撑成不可收缩
    <div className="min-w-0">
      <ToolRowBase
        icon={<IconTool className="size-3" />}
        shimmerLabel="调用工具"
        completeLabel="调用工具"
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
        elems.push(<ToolCallRow key={key} toolCall={part} toolResult={toolResult} />);
        return;
      }

      if (isToolResultPart(part)) {
        // 已被对应 tool-call 渲染过则跳过
        if (consumedResults.has(part.toolCallId)) return;
        // 孤儿 result（缺少对应 tool-call）：用占位 call 渲染
        elems.push(
          <ToolCallRow
            key={key}
            toolCall={{
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            }}
            toolResult={part}
          />
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
