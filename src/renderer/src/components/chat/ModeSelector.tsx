import { cn } from '@/lib/utils';
import { memo, useCallback, useState, type ComponentType } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
 * 模式选择器：左侧 icon + 当前模式名 + 右侧 chevron，点击展开菜单。
 * 受控/非受控均可，单模式时退化为静态标签。
 * 菜单用 ui/dropdown-menu，与书库、会话列表的菜单共用同一套条目规格。
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
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-body leading-none text-ink-tertiary transition-colors hover:bg-hover-fill',
        !hasMultiple && 'pointer-events-none',
        className
      )}
      aria-label="Select mode"
    >
      {ActiveIcon && <ActiveIcon className="size-4 shrink-0" />}
      <span className="font-medium">{activeMode?.label}</span>
      {hasMultiple && <ChevronDown className="size-3.5 text-ink-caption" />}
    </button>
  );

  // 只有一个模式时没有可选项，不需要菜单
  if (!hasMultiple) return trigger;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        {modes.map(mode => {
          const isActive = mode.id === activeMode?.id;
          const Icon = mode.icon;
          return (
            <DropdownMenuItem
              key={mode.id}
              // 条目不渲染说明文字，保持与其它菜单同为单行；说明放在悬停提示里
              title={mode.description}
              onSelect={() => handleSelect(mode.id)}
              className="cursor-pointer"
            >
              {Icon && <Icon />}
              <span className="min-w-0 flex-1 truncate font-medium">{mode.label}</span>
              {isActive && <Check className="text-ink-tertiary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
