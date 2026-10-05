import { memo } from 'react';
import { IconAlertTriangle, IconArrowsMinimize } from '@tabler/icons-react';
import type { AppUIMessage } from '@/types/message';
import { isCompactionPart } from '@/utils/message-util';
import { SpiralLoader } from '../SpiralLoader';
import { ToolRowBase } from '../tools/ToolRowBase';

/**
 * 上下文压缩提示：把更早的对话压成摘要时，在消息流里插一行。
 * 只标记这件事发生过（压缩中流光、结束后定格）；摘要正文与用量不展示。
 */
export const CompactionNotice = memo(function CompactionNotice({ msg }: { msg: AppUIMessage }) {
  const part = msg.parts.find(isCompactionPart);
  if (!part) return null;

  if (part.state === 'error') {
    return (
      <div className="flex max-w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[13px] text-destructive">
        <IconAlertTriangle className="size-3 shrink-0" />
        <span className="shrink-0">上下文压缩失败</span>
        {part.errorText && <span className="min-w-0 truncate opacity-70">{part.errorText}</span>}
      </div>
    );
  }

  const isStreaming = part.state === 'streaming';

  return (
    <ToolRowBase
      icon={isStreaming ? <SpiralLoader size={12} /> : <IconArrowsMinimize className="size-3" />}
      shimmerLabel="正在压缩上下文"
      completeLabel="上下文已压缩"
      isAnimating={isStreaming}
    />
  );
});
