'use client';

import { memo, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AppUIMessage } from '@/types/message';
import { isImagePart, isTextPart } from '@/utils/message-util';
import { toAppImageUrl } from '@/utils/image-util';
import { ImagePreviewDialog } from './ImagePreview';

export type UserMessageProps = {
  message: AppUIMessage;
  className?: string;
  /** 是否允许点击图片全屏预览 */
  enableImagePreview?: boolean;
};

/** 用户消息：渲染图片 part 与 text part，气泡右对齐 */
export const UserMessage = memo(function UserMessage({
  message,
  className,
  enableImagePreview = true,
}: UserMessageProps) {
  /** 正在预览的图片地址 */
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const text = (message.parts ?? [])
    .filter(isTextPart)
    .map(p => p.text)
    .join('');
  const images = (message.parts ?? []).filter(isImagePart);

  const handlePreview = useCallback(
    (path: string) => {
      if (enableImagePreview) setPreviewSrc(toAppImageUrl(path));
    },
    [enableImagePreview]
  );

  if (!text && images.length === 0) return null;

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <div className="max-w-[80%] min-w-0 flex flex-col items-end gap-2">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {images.map(image => (
              <button
                key={image.path}
                type="button"
                onClick={() => handlePreview(image.path)}
                title="预览图片"
                aria-label="预览图片"
                className="block cursor-pointer rounded-xl border-0 bg-transparent p-0"
              >
                <img
                  src={toAppImageUrl(image.path)}
                  alt="图片"
                  className="h-24 w-24 rounded-xl object-cover ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
                />
              </button>
            ))}
          </div>
        )}

        {text && (
          <div className="px-3.5 py-1.5 text-[15px] transition-colors rounded-2xl bg-muted text-foreground">
            <p className="leading-5 wrap-break-word whitespace-pre-wrap">{text}</p>
          </div>
        )}
      </div>

      <ImagePreviewDialog
        src={previewSrc}
        onOpenChange={open => {
          if (!open) setPreviewSrc(null);
        }}
      />
    </div>
  );
});
