import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/** 预览浮层属性。 */
type PreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 读屏标题；不渲染可见标题 */
  title: string;
  children: ReactNode;
};

/** 全屏内容区：透明底，深色遮罩由 overlayClassName 提供。 */
const PREVIEW_CONTENT_CLASS =
  'h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-transparent p-0 shadow-none outline-none sm:rounded-none';

/**
 * 全屏预览浮层：深色遮罩 + 居中内容，图片与图表共用同一套外壳。
 *
 * 内容区自带的关闭按钮被隐藏：关闭键由内容自己的工具条提供，避免和窗口右上角的关闭按钮重叠；
 * 遮罩与 Esc 关闭仍由 Dialog 负责。浮层覆盖在应用顶栏之上，必须声明 no-drag，否则在顶部拖动会拖到窗口。
 * 打开时把焦点放在浮层本身而不是第一个工具按钮：Radix 的 Tooltip 在 focus 时会弹出，
 * 自动聚焦到「缩小」会让它在每次打开预览时都弹一次。
 */
export function PreviewDialog({ open, onOpenChange, title, children }: PreviewDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className={PREVIEW_CONTENT_CLASS}
        overlayClassName="bg-mask-4 backdrop-blur-sm"
        closeButtonClassName="hidden"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        onOpenAutoFocus={event => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
