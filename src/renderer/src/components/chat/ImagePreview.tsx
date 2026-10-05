'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export type ImagePreviewDialogProps = {
  /** 待预览图片的 app:// 地址；为 null 表示关闭 */
  src: string | null;
  /** 弹窗开关变化回调，关闭时调用方应把 src 置空 */
  onOpenChange: (open: boolean) => void;
};

/**
 * 图片预览弹窗：受控组件，输入框草稿与已发送的气泡共用。
 * 内容区去掉默认留白与背景，让图片按视口大小自适应并保持原始比例。
 */
export function ImagePreviewDialog({ src, onOpenChange }: ImagePreviewDialogProps) {
  /** 关闭瞬间记下的图片地址：调用方会立刻把 src 置空，退场动画期间仍要显示这张图 */
  const [closingSrc, setClosingSrc] = useState<string | null>(null);

  /** 关闭时先留住当前图片，再交给调用方清空 src */
  const handleOpenChange = (open: boolean): void => {
    setClosingSrc(open ? null : src);
    onOpenChange(open);
  };

  // 有 src 时用 src，关闭后回落到留住的那张，避免退场时只剩遮罩和关闭按钮
  const shownSrc = src ?? closingSrc;

  return (
    <Dialog open={Boolean(src)} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[90vw] border-0 bg-transparent p-0 text-white shadow-none">
        {/* Radix 要求内容区必须有无障碍标题，这里只供读屏使用 */}
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        {shownSrc && (
          <img
            src={shownSrc}
            alt="图片预览"
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
