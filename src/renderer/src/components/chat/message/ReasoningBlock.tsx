import { IconBulb } from '@tabler/icons-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToolRowBase } from '../tools/ToolRowBase';
import type { AppReasoningPart } from '@/types/message';

/**
 * 推理块：默认收起的一行。流式时标签流光，点开才看推理正文（与工具行同一套观感）。
 */
export function ReasoningBlock({ part }: { part: AppReasoningPart }) {
  const isStreaming = part.state === 'streaming';

  return (
    <ToolRowBase
      icon={<IconBulb className="size-4" />}
      shimmerLabel="思考"
      completeLabel="思考"
      isAnimating={isStreaming}
      expandable={Boolean(part.text)}
    >
      {/* chat-inline-scroll 负责限高与滚动条（见 chat.css） */}
      <ScrollArea className="chat-inline-scroll">
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{part.text}</p>
      </ScrollArea>
    </ToolRowBase>
  );
}
