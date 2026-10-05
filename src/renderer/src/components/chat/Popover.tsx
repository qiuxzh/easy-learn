'use client';

import type { ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: PopoverSide;
  align?: PopoverAlign;
  sideOffset?: number;
  className?: string;
};

/** 轻量封装：基于 @base-ui/react/popover，统一弹层样式 */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = 'top',
  align = 'start',
  sideOffset = 6,
  className,
}: PopoverProps) {
  return (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? next => onOpenChange(next) : undefined}
    >
      <BasePopover.Trigger
        nativeButton={false}
        render={props => (
          <span {...props} className="inline-flex">
            {trigger}
          </span>
        )}
      />
      <BasePopover.Portal>
        {/* 弹层要压在常驻浮层（z-panel）之上，故用 z-popover */}
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-popover"
        >
          <BasePopover.Popup
            className={cn(
              'min-w-[180px] rounded-[10px] border border-border bg-popover p-1 shadow-lg outline-none',
              'text-popover-foreground',
              className
            )}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
