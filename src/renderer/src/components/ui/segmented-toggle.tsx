import { cn } from '@/lib/utils';

/** 分段切换选项。 */
type SegmentedToggleOption<T extends string> = {
  value: T;
  label: string;
};

/** 分段切换属性。options 支持任意段数（至少两段） */
type SegmentedToggleProps<T extends string> = {
  value: T;
  options: readonly SegmentedToggleOption<T>[];
  onChange: (value: T) => void;
};

/** 分段胶囊切换控件。 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: SegmentedToggleProps<T>) {
  // 选中项不存在（配置值不在选项里）时退化为第一段，避免指示块飞出控件
  const selectedIndex = Math.max(
    0,
    options.findIndex(option => option.value === value)
  );
  // 指示块宽度与位移都按段数算，2 段时与原先的 50% / translate-x-full 等价
  const segmentWidth = `calc(${100 / options.length}% - 0.125rem)`;

  return (
    <div
      className="relative inline-grid h-7 w-max shrink-0 whitespace-nowrap rounded-full bg-muted p-0.5 text-xs"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label="分段切换"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-card transition-transform duration-200 ease-out"
        style={{ width: segmentWidth, transform: `translateX(${selectedIndex * 100}%)` }}
      />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={cn(
            'relative z-10 cursor-pointer whitespace-nowrap rounded-full px-2.5 font-medium transition-colors',
            value === option.value
              ? 'font-semibold text-card-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
