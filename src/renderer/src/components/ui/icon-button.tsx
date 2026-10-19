import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type IconButtonProps = Omit<ButtonProps, 'icon' | 'children' | 'asChild'> & {
  /** 按钮用途：同时作为可访问名与悬浮提示文案 */
  label: string;
  /** 提示方向，默认朝上 */
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
};

/**
 * 单个图标的按钮：label 必填，悬浮显示用途，读屏读同一句。
 *
 * 不能放进 DropdownMenuTrigger / PopoverTrigger 的 asChild 里：Radix 要求 Tooltip 在触发器外层，
 * 而这里的 Tooltip 固定在内层，被触发器包住时 props 会落到不渲染 DOM 的 Tooltip 上，弹层打不开。
 * 那类位置直接用 Button 并自带 aria-label。
 */
export function IconButton({
  label,
  side = 'top',
  variant = 'ghost',
  size = 'sm',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} icon aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
