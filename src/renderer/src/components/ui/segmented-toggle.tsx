import { cn } from '@/lib/utils';

/** 两段式切换选项。 */
type SegmentedToggleOption<T extends string> = {
  value: T;
  label: string;
};

/** 两段式切换属性。 */
type SegmentedToggleProps<T extends string> = {
  value: T;
  options: readonly [SegmentedToggleOption<T>, SegmentedToggleOption<T>];
  onChange: (value: T) => void;
};

/** 两段式胶囊切换控件。 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: SegmentedToggleProps<T>) {
  return (
    <div
      className="relative inline-grid h-7 w-max shrink-0 grid-cols-2 whitespace-nowrap rounded-full bg-muted p-0.5 text-xs"
      role="group"
      aria-label="分段切换"
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-full bg-card shadow-sm transition-transform duration-200 ease-out',
          value === options[1].value && 'translate-x-full'
        )}
      />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={cn(
            'relative z-10 cursor-pointer whitespace-nowrap rounded-full px-3 font-medium transition-colors',
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
