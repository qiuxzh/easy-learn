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
} from 'react';
import { Brain, ImagePlus, Sparkles, X, Zap } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from 'sonner';
import type { ImageContent, ThinkingLevel } from '@shared/types/chat';
import { toAttachmentUrl } from '@/utils/image-util';
import { SendButton } from './SendButton';
import { ImagePreviewDialog } from './ImagePreview';
import { ModeSelector, type ModeOption } from './ModeSelector';
import type { ChatStatus } from './message/utils';

/** 单条消息允许携带的图片数量上限 */
const MAX_IMAGES = 5;

/** 思考级别选项：id 直接取 ThinkingLevel 的取值 */
const THINKING_MODES: ModeOption[] = [
  { id: 'off', label: '快速回答', icon: Zap, description: '直接作答，不额外推理' },
  { id: 'medium', label: '思考', icon: Brain, description: '先推理再作答' },
  { id: 'max', label: '深度思考', icon: Sparkles, description: '花更多推理时间处理复杂问题' },
];

/** 把模式 id 收敛到思考级别；未知取值（如旧版本存下的模式名）一律按不思考处理 */
function toThinkingLevel(modeId: string | null): ThinkingLevel {
  switch (modeId) {
    case 'medium':
      return 'medium';
    case 'max':
      return 'max';
    default:
      return 'off';
  }
}

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

/** 输入区产出的消息：思考级别由输入区自己决定，调用方不需要知道 */
export type InputBarSendPayload = {
  content: string;
  images: ImageContent[];
  thinkingLevel: ThinkingLevel;
};

export type InputBarProps = {
  onSend: (message: InputBarSendPayload) => void;
  status: ChatStatus;
  onStop: () => void;
  /** 输入框尺寸，影响内边距和整体高度 */
  size?: 'sm' | 'md' | 'lg';
};

/**
 * 输入框：文本输入 + Enter 发送 + 流式停止，以及图片输入（粘贴 / 文件选择）。
 * 图片粘贴或选择后立刻交给主进程登记为附件，这里只保留附件 id。
 */
export const InputBar = memo(function InputBar({
  onSend,
  status,
  onStop,
  size = 'md',
}: InputBarProps) {
  const [input, setInput] = useState('');
  /** 思考级别是输入区的偏好：初值读 localStorage，改动即写回 */
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() =>
    toThinkingLevel(localStorage.getItem('thinkingMode'))
  );
  /** 待发送图片，只保存附件 id */
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

  /** 图片入库：带 source 时登记粘贴的字节，不带时由主进程弹框选择，数量收敛到上限内并入草稿 */
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
        const stored = await window.api.storeAttachments({ images: source });
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
    [images.length]
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
  const handleRemoveImage = useCallback((attachmentId: string) => {
    setImages(prev => prev.filter(image => image.attachmentId !== attachmentId));
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || isStreaming) return;
    onSend({ content: trimmed, images, thinkingLevel });
    setInput('');
    setImages([]);
  }, [input, images, isStreaming, onSend, thinkingLevel]);

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

  // 思考级别是跨会话保留的偏好，改动后立即持久化
  useEffect(() => {
    localStorage.setItem('thinkingMode', thinkingLevel);
  }, [thinkingLevel]);

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
        className="relative cursor-text rounded-2xl bg-background shadow-soft"
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
      >
        <div className={`${sizeStyle.container} ${sizeStyle.minHeight}`}>
          {images.length > 0 && (
            <div className="mb-2 -mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-1.5">
              {images.map(image => (
                <div key={image.attachmentId} className="group/image relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewSrc(toAttachmentUrl(image.attachmentId))}
                    title="预览图片"
                    aria-label="预览图片"
                    className="block cursor-pointer rounded-lg border-0 bg-transparent p-0"
                  >
                    <img
                      src={toAttachmentUrl(image.attachmentId)}
                      alt="待发送图片"
                      className="h-16 w-16 rounded-md object-cover ring-1 ring-stroke-2 transition-opacity hover:opacity-90"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(image.attachmentId)}
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
            className="w-full resize-none bg-transparent border-0 outline-none text-body-lg leading-[1.6] text-foreground placeholder:text-ink-tertiary min-h-[1.6em] overflow-y-auto"
            style={{ fieldSizing: 'content', maxHeight: '120px' }}
          />
        </div>

        <div className={`flex items-center justify-between gap-3 ${sizeStyle.toolbar}`}>
          <ModeSelector
            modes={THINKING_MODES}
            value={thinkingLevel}
            onChange={id => setThinkingLevel(toThinkingLevel(id))}
          />
          <div className="flex items-center gap-1.5">
            <IconButton
              type="button"
              variant="quiet"
              label={isFull ? `最多添加 ${MAX_IMAGES} 张图片` : '添加图片'}
              onClick={handlePickImages}
              disabled={isStoring}
            >
              <ImagePlus />
            </IconButton>
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
