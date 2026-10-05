import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { cn } from '@/lib/utils';
import type { AppUIMessage } from '@/types/message';
import { useVirtualizer } from '@tanstack/react-virtual';

import { UserMessage } from '../UserMessage';
import { SpiralLoader } from '../SpiralLoader';
import { ToolRowBase } from '../tools/ToolRowBase';
import { AssistantParts } from './AssistantParts';
import { CompactionNotice } from './CompactionNotice';
import { MessageToolbar, formatTimestamp } from './MessageToolbar';
import { TraceUsage } from './TraceUsage';
import {
  ChatStatus,
  getAssistantText,
  getUserText,
  groupMessagesIntoTraces,
  traceAssistantMessages,
  traceHasContent,
  type Trace,
} from './utils';

/** 距离底部多少像素以内仍视为"在底部"（用于流式输出自动跟随） */
const SCROLL_THRESHOLD = 80;

export type MessageListProps = {
  /** 完整消息数组（按时间顺序） */
  messages: AppUIMessage[];
  /** 当前 chat 状态 */
  status: ChatStatus;
  /** 根容器附加 class */
  className?: string;
  /** 是否启用用户消息图片的点击全屏预览 */
  enableImagePreview?: boolean;
  /** 可替换的子组件插槽 */
  slots?: {
    /** 自定义用户消息渲染组件 */
    UserMessage?: ComponentType<{
      message: AppUIMessage;
      className?: string;
      enableImagePreview?: boolean;
    }>;
  };
  classNames?: {
    userMessage?: string;
  };
};

/**
 * 一个 trace：虚拟列表的一行 = 一条用户消息 + 其后的助手消息。
 * 按顺序渲染用户气泡、助手内容（含夹在中间的系统提示）、以及末尾的"思考中"提示。
 */
function TraceItem({
  trace,
  isLastTrace,
  showPlanning,
  isStreaming,
  activeCopyId,
  onCopy,
  UserMessageComponent,
  enableImagePreview,
  userClassName,
}: {
  trace: Trace;
  isLastTrace: boolean;
  /** 整条 trace 内任一 assistant message 都没收到任何 part 时为 true（用于显示"思考中"） */
  showPlanning: boolean;
  isStreaming: boolean;
  activeCopyId: string | null;
  onCopy: (id: string) => void;
  UserMessageComponent: ComponentType<{
    message: AppUIMessage;
    className?: string;
    enableImagePreview?: boolean;
  }>;
  enableImagePreview: boolean;
  userClassName?: string;
}) {
  const { userMsg, nodes } = trace;
  const isTraceStreaming = isStreaming && isLastTrace;

  // 用户气泡：有正文或带附件（parts）时才渲染
  const userText = getUserText(userMsg);
  const hasUserBlock = Boolean(userText) || userMsg.parts.length > 0;
  const userCreatedAt = (userMsg as { createdAt?: Date | string }).createdAt;
  const userTimestamp = userCreatedAt ? formatTimestamp(new Date(userCreatedAt)) : undefined;
  const userCopyKey = `user-${userMsg.id}`;
  const showUserToolbar = Boolean(userText) || Boolean(userTimestamp);

  // 助手内容区：有助手消息或有系统提示（如压缩标记）就渲染。
  // 例外是末尾 trace 还在等首个 token——那时整块先隐藏只留"Processing..."，但压缩提示要一直可见。
  const assistantMsgs = traceAssistantMessages(trace);
  const hasNotice = nodes.some(msg => msg.role === 'system');
  const hasAssistantBlock = nodes.length > 0 && (hasNotice || !(isLastTrace && showPlanning));
  const assistantText = getAssistantText(assistantMsgs);
  const showAssistantToolbar = Boolean(assistantText.trim()) && !isTraceStreaming;
  const assistantCopyKey = `assistant-${userMsg.id}-all`;
  const assistantCopyVisible = activeCopyId === assistantCopyKey;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-3 pb-6 space-y-2">
      {hasUserBlock && (
        <div className="group/user-message">
          <UserMessageComponent
            message={userMsg}
            className={userClassName}
            enableImagePreview={enableImagePreview}
          />
          {showUserToolbar && (
            <MessageToolbar
              text={userText}
              timestamp={userTimestamp}
              heightClass="h-[28px]"
              hoverClass="group-hover/user-message:opacity-100 group-hover/user-message:pointer-events-auto"
              isVisible={activeCopyId === userCopyKey}
              alignClass="justify-end"
              onCopied={() => onCopy(userCopyKey)}
            />
          )}
        </div>
      )}

      {hasAssistantBlock && (
        <div className="group/assistant-trace">
          <div className="flex flex-col gap-3">
            {nodes.map(msg =>
              msg.role === 'assistant' ? (
                <AssistantParts key={msg.id} msg={msg} />
              ) : (
                <CompactionNotice key={msg.id} msg={msg} />
              )
            )}
          </div>
          {/* 复制按钮靠左，统计靠右；两者都不渲染时该行高度为 0 */}
          <div className="mt-2 flex items-center gap-1.5">
            {/* 默认只在有正文且非流式时显示；刚复制过时即使处于流式也保留，便于连续复制 */}
            {showAssistantToolbar || assistantCopyVisible ? (
              <MessageToolbar
                text={assistantText}
                heightClass="h-7"
                hoverClass="group-hover/assistant-trace:opacity-100 group-hover/assistant-trace:pointer-events-auto"
                isVisible={showAssistantToolbar ? assistantCopyVisible : true}
                alignClass="justify-start"
                onCopied={() => onCopy(assistantCopyKey)}
              />
            ) : null}
            {/* 该 trace 跑完之前不显示统计：用量要等每个 turn 的请求结束才有值 */}
            {!isTraceStreaming && (
              <div className="ml-auto">
                <TraceUsage messages={assistantMsgs} />
              </div>
            )}
          </div>
        </div>
      )}

      {isLastTrace && showPlanning && (
        <ToolRowBase
          icon={<SpiralLoader size={12} />}
          shimmerLabel="Processing..."
          completeLabel="Done"
          isAnimating={true}
        />
      )}
    </div>
  );
}

/**
 * 消息列表：基于 @tanstack/react-virtual 的虚拟滚动。
 * - 滚动容器 = Radix ScrollArea 的 Viewport
 * - 每个 trace 是一个绝对定位的虚拟行
 * - 用户主动上滚后取消自动跟随；流式输出只在贴底时跟随
 */
export const MessageList = memo(function MessageList({
  messages,
  status,
  className,
  enableImagePreview = true,
  slots,
  classNames,
}: MessageListProps) {
  // 滚动视口：virtualizer 的 scroll element 必须是真实滚动的容器
  const viewportRef = useRef<HTMLDivElement>(null);
  // 用户向上滚动后取消自动跟随，避免流式更新把用户"顶"走
  const shouldAutoScrollRef = useRef(true);

  const [activeCopyId, setActiveCopyId] = useState<string | null>(null);

  const CustomUserMessage = slots?.UserMessage ?? UserMessage;

  const markCopied = useCallback((id: string) => {
    setActiveCopyId(id);
  }, []);

  // 点击其他区域时取消复制工具栏的高亮
  useEffect(() => {
    const handlePointerDown = () => {
      setActiveCopyId(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const traces = useMemo(() => groupMessagesIntoTraces(messages), [messages]);
  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;

  // 规划提示：trace 内任一 assistant message 还没收到任何 part 时显示"思考中"
  const showPlanning = useMemo(() => {
    if (!lastMessage) return false;
    const lastTrace = traces[traces.length - 1];
    if (!lastTrace) return false;
    if (lastMessage.role === 'user' && lastTrace.nodes.length === 0) return true;
    return isStreaming && !traceHasContent(lastTrace);
  }, [isStreaming, traces, lastMessage]);

  // 虚拟滚动：每个 trace 是一个虚拟行
  const virtualizer = useVirtualizer({
    count: traces.length,
    getScrollElement: () => viewportRef.current,
    // 平均估值：virtualizer 会通过 measureElement 自动校正
    estimateSize: () => 160,
    // 减小预渲染窗口，避免切到会话瞬间批量渲染大量重组件。
    overscan: 3,
    getItemKey: index => traces[index]?.userMsg.id ?? `trace-${index}`,
  });

  // 监听滚动：判断当前是否贴底
  const handleViewportScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < SCROLL_THRESHOLD;
  }, []);

  // 滚到底部
  const scrollToEnd = useCallback(() => {
    if (traces.length === 0) return;
    virtualizer.scrollToIndex(traces.length - 1, { align: 'end' });
  }, [traces.length, virtualizer]);

  // 初始展示：消息就绪后立刻滚到末尾（仅触发一次）。
  // 不依赖 lastMessageId 变化，避免历史会话切换时漏触发。
  const initialScrolledRef = useRef(false);
  useEffect(() => {
    if (initialScrolledRef.current) return;
    if (traces.length === 0) return;
    initialScrolledRef.current = true;
    shouldAutoScrollRef.current = true;
    scrollToEnd();
  }, [traces.length, scrollToEnd]);

  // 滚动跟随：合并用户发新消息 + assistant 流式更新两种触发
  // - 新 user 消息：强制开启自动跟随并滚到底
  // - 新 assistant 消息：仅在贴底时跟随（避免把主动上滚的用户"顶"走）
  useEffect(() => {
    if (!lastMessageId || !lastMessage) return;
    if (lastMessage.role === 'user') {
      shouldAutoScrollRef.current = true;
      scrollToEnd();
      return;
    }
    if (lastMessage.role === 'assistant' && shouldAutoScrollRef.current) {
      scrollToEnd();
    }
  }, [lastMessageId, lastMessage, scrollToEnd]);

  return (
    // 用原生 div 充当滚动容器：virtualizer 自己控制滚动测量，
    // 不再需要 Radix ScrollArea 的 rAF 包装（之前会与 virtualizer 产生强制 reflow 竞争）。
    // chat-message-viewport 类用于 chat.css 中的滚动条样式定制。
    <div
      ref={viewportRef}
      onScroll={handleViewportScroll}
      className={cn(
        'chat-message-list chat-message-viewport flex-1 min-h-0 min-w-0 overflow-y-auto',
        className
      )}
    >
      {/* virtualizer 的总高度容器：所有虚拟行 absolute 定位到这 */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const trace = traces[virtualRow.index];
          if (!trace) return null;
          const isLastTrace = virtualRow.index === traces.length - 1;
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TraceItem
                trace={trace}
                isLastTrace={isLastTrace}
                showPlanning={showPlanning}
                isStreaming={isStreaming}
                activeCopyId={activeCopyId}
                onCopy={markCopied}
                UserMessageComponent={CustomUserMessage}
                enableImagePreview={enableImagePreview}
                userClassName={classNames?.userMessage}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
