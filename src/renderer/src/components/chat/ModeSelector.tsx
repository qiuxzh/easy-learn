'use client';

import { memo, useCallback, useState, type ComponentType } from 'react';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Popover } from './Popover';

export type ModeOption = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  description?: string;
};

export type ModeSelectorProps = {
  modes: ModeOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (modeId: string) => void;
  className?: string;
};

/**
 * 模式选择器：左侧 icon + 当前模式名 + 右侧 chevron，点击展开浮层。
 * 受控/非受控均可，单模式时退化为静态标签。
 */
export const ModeSelector = memo(function ModeSelector({
  modes,
  value,
  defaultValue,
  onChange,
  className,
}: ModeSelectorProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeId = isControlled ? value : internalValue;
  const activeMode = modes.find(m => m.id === activeId) ?? modes[0];
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      if (!isControlled) setInternalValue(id);
      onChange?.(id);
      setOpen(false);
    },
    [isControlled, onChange]
  );

  if (modes.length === 0) return null;
  const ActiveIcon = activeMode?.icon;
  const hasMultiple = modes.length > 1;

  const trigger = (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] leading-none text-foreground/70 transition-colors hover:bg-foreground/5 cursor-pointer',
        !hasMultiple && 'pointer-events-none',
        className
      )}
      aria-label="Select mode"
    >
      {ActiveIcon && <ActiveIcon className="size-4 shrink-0" />}
      <span className="font-medium">{activeMode?.label}</span>
      {hasMultiple && <IconChevronDown className="size-3.5 text-foreground/50" />}
    </button>
  );

  if (!hasMultiple) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen} side="top" align="start" trigger={trigger}>
      {modes.map(mode => {
        const isActive = mode.id === activeMode?.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => handleSelect(mode.id)}
            className={cn(
              'flex w-full items-start gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] leading-5 text-foreground transition-colors hover:bg-foreground/5 cursor-pointer',
              isActive && 'bg-foreground/5'
            )}
          >
            {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium">{mode.label}</span>
              {mode.description && (
                <span className="block truncate text-foreground/40">{mode.description}</span>
              )}
            </span>
            {isActive && <IconCheck className="mt-0.5 size-4 shrink-0 text-foreground/60" />}
          </button>
        );
      })}
    </Popover>
  );
});
