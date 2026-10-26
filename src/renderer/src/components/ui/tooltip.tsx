import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

/** 焦点回填在窗口激活时同步完成，守卫只需要覆盖这一瞬间；300ms 是超时兜底。 */
const RESTORE_FOCUS_GUARD_MS = 300;

/**
 * 最小化或 Alt+Tab 离开再回到窗口时，之前聚焦的按钮会莫名弹出 tooltip：Chromium 在窗口重新聚焦时把焦点回填给上次聚焦的元素，Radix 的 TooltipTrigger 把这次 focus 当成打开请求并立即显示提示。
 * 守卫在恢复后的短窗口内丢弃这次 focus 打开；真实输入（pointerdown / keydown）会先于元素 focus 到达并解除守卫，悬停与键盘聚焦不受影响。
 * @returns 读取当前是否处于焦点回填窗口的 ref
 */
function useRestoreFocusGuard() {
  const guardRef = React.useRef(false);

  React.useEffect(() => {
    let timer = 0;
    const arm = () => {
      guardRef.current = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        guardRef.current = false;
      }, RESTORE_FOCUS_GUARD_MS);
    };
    const disarm = () => {
      guardRef.current = false;
      window.clearTimeout(timer);
    };

    window.addEventListener('focus', arm);
    // 真实输入一定先于元素 focus 到达，解除不会误伤用户主动聚焦
    window.addEventListener('pointerdown', disarm, true);
    window.addEventListener('keydown', disarm, true);
    return () => {
      window.removeEventListener('focus', arm);
      window.removeEventListener('pointerdown', disarm, true);
      window.removeEventListener('keydown', disarm, true);
      window.clearTimeout(timer);
    };
  }, []);

  return guardRef;
}

const Tooltip = ({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) => {
  const restoreFocusRef = useRestoreFocusGuard();
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const isControlled = openProp !== undefined;

  return (
    <TooltipPrimitive.Root
      {...props}
      open={isControlled ? openProp : open}
      onOpenChange={next => {
        // 窗口恢复时回填的 focus 不算用户意图，丢弃这次打开
        if (next && restoreFocusRef.current) return;
        if (!isControlled) setOpen(next);
        onOpenChange?.(next);
      }}
    />
  );
};

const TooltipProvider = TooltipPrimitive.Provider;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
