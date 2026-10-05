'use client';

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ImageContent } from '@shared/types/chat';
import { toAppImageUrl } from '@/utils/image-util';
import { SendButton } from './SendButton';
import { ImagePreviewDialog } from './ImagePreview';
import type { ChatStatus } from './message/utils';

/** 单条消息允许携带的图片数量上限 */
const MAX_IMAGES = 5;

const INPUT_SIZE_STYLE: Record<
  'sm' | 'md' | 'lg',
  { container: string; minHeight: string; toolbar: string }
> = {
  sm: {
    container: 'pt-2 pb-0 pr-2 pl-3',
    minHeight: 'min-h-[38px]',
    toolbar: 'px-1.5 pt-0.5 pb-1.5',
  },
  md: { container: 'pt-3 pb-0 pr-3 pl-3.5', minHeight: 'min-h-[44px]', toolbar: 'px-2 pt-1 pb-2' },
  lg: {
    container: 'pt-3.5 pb-0 pr-3.5 pl-4',
    minHeight: 'min-h-[53px]',
    toolbar: 'px-2.5 pt-1.5 pb-2.5',
  },
};

export type InputBarProps = {
  onSend: (message: { role: 'user'; content: string; images: ImageContent[] }) => void;
  status: ChatStatus;
  onStop: () => void;
  /** 当前会话 id，图片落盘时按会话分目录 */
  sessionId: string;
  /** 输入框尺寸，影响内边距和整体高度 */
  size?: 'sm' | 'md' | 'lg';
  /** 渲染在工具栏左侧、发送按钮右侧的内容（如模式选择器） */
  leftActions?: ReactNode;
};

/**
 * 输入框：文本输入 + Enter 发送 + 流式停止，以及图片输入（粘贴 / 文件选择）。
 * 图片不驻留内存：粘贴或选择后立刻交给主进程落盘，这里只保留可引用的路径。
 */
export const InputBar = memo(function InputBar({
  onSend,
  status,
  onStop,
  sessionId,
  size = 'md',
  leftActions,
}: InputBarProps) {
  const [input, setInput] = useState('');
  /** 待发送图片；只保存已落盘的引用，预览时拼 app:// 地址 */
  const [images, setImages] = useState<ImageContent[]>([]);
  /** 是否有图片正在落盘，期间禁用再次添加 */
  const [isStoring, setIsStoring] = useState(false);
  /** 落盘请求是否在途，用于阻止并发添加导致超出上限 */
  const storingRef = useRef(false);
  /** 正在预览的图片地址 */
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isFull = images.length >= MAX_IMAGES;

  /**
   * 图片入库：带 source 时落盘粘贴的字节，不带时由主进程弹框选择。
   * 校验、压缩、落盘都在主进程完成，这里负责把数量收敛到上限内再并入草稿。
   */
  const storeImages = useCallback(
    async (source?: { bytes: Uint8Array; mimeType: string }[]) => {
      if (storingRef.current) return;

      const remain = MAX_IMAGES - images.length;
      if (remain <= 0) {
        toast.error(`最多添加 ${MAX_IMAGES} 张图片`);
        return;
      }

      storingRef.current = true;
      setIsStoring(true);
      try {
        const stored = await window.api.storeImages({ sessionId, images: source });
        // 弹框选择的数量由用户决定，超出剩余额度的部分只提示、不加入草稿
        const accepted = stored.slice(0, remain);
        if (accepted.length < stored.length) {
          toast.error(
            `最多添加 ${MAX_IMAGES} 张图片，已忽略多余的 ${stored.length - accepted.length} 张`
          );
        }
        if (accepted.length > 0) {
          setImages(prev => [...prev, ...accepted]);
        }
      } catch (error) {
        toast.error(`图片添加失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        storingRef.current = false;
        setIsStoring(false);
      }
    },
    [images.length, sessionId]
  );

  /** 文件选择：弹框、读取、压缩与落盘都在主进程完成，这里只接收图片引用 */
  const handlePickImages = useCallback(() => {
    if (isStoring) return;
    void storeImages();
  }, [isStoring, storeImages]);

  /** 粘贴：剪贴板里有图片文件时接管，纯文本粘贴仍走默认行为 */
  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData.items)
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (files.length === 0) return;

      e.preventDefault();
      void (async () => {
        const source = await Promise.all(
          files.map(async file => ({
            bytes: new Uint8Array(await file.arrayBuffer()),
            mimeType: file.type,
          }))
        );
        await storeImages(source);
      })();
    },
    [storeImages]
  );

  /** 从草稿里移除一张图片 */
  const handleRemoveImage = useCallback((path: string) => {
    setImages(prev => prev.filter(image => image.path !== path));
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || isStreaming) return;
    onSend({ role: 'user', content: trimmed, images });
    setInput('');
    setImages([]);
  }, [input, images, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleContainerClick = useCallback((e: ReactMouseEvent) => {
    if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('button, textarea')) {
      textareaRef.current?.focus();
    }
  }, []);

  // 外层 div 用 onClick 做"点空白聚焦"，a11y 规则要求有等价键盘处理
  const handleContainerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    }
  }, []);

  // 流式结束后自动让输入框获得焦点
  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  const hasContent = input.trim().length > 0 || images.length > 0;
  const sizeStyle = INPUT_SIZE_STYLE[size];

  const handleSendButtonClick = useCallback(() => {
    if (isStreaming) onStop();
    else if (hasContent) handleSubmit();
  }, [isStreaming, onStop, hasContent, handleSubmit]);

  return (
    <div className="shrink-0 px-3 pb-3">
      <div
        role="presentation"
        className="relative cursor-text rounded-2xl bg-background shadow-2xs ring-1 ring-foreground/10"
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
      >
        <div className={`${sizeStyle.container} ${sizeStyle.minHeight}`}>
          {images.length > 0 && (
            <div className="mb-2 -mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-1.5">
              {images.map(image => (
                <div key={image.path} className="group/image relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewSrc(toAppImageUrl(image.path))}
                    title="预览图片"
                    aria-label="预览图片"
                    className="block cursor-pointer rounded-lg border-0 bg-transparent p-0"
                  >
                    <img
                      src={toAppImageUrl(image.path)}
                      alt="待发送图片"
                      className="h-16 w-16 rounded-lg object-cover ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(image.path)}
                    title="移除图片"
                    aria-label="移除图片"
                    className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-foreground text-background opacity-0 transition-opacity group-hover/image:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="发消息…"
            className="w-full resize-none bg-transparent border-0 outline-none text-[15px] leading-[1.6] text-foreground placeholder:text-muted-foreground/60 min-h-[1.6em] overflow-y-auto"
            style={{ fieldSizing: 'content', maxHeight: '120px' }}
          />
        </div>

        <div className={`flex items-center justify-between gap-3 ${sizeStyle.toolbar}`}>
          <div className="flex items-center gap-1 min-w-0">{leftActions}</div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePickImages}
              disabled={isStoring}
              title={isFull ? `最多添加 ${MAX_IMAGES} 张图片` : '添加图片'}
              aria-label="添加图片"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleSendButtonClick}
              aria-label={isStreaming ? '停止生成' : '发送'}
              className="cursor-pointer bg-transparent border-0 p-0"
            >
              <SendButton state={isStreaming ? 'streaming' : hasContent ? 'typing' : 'idle'} />
            </button>
          </div>
        </div>
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
