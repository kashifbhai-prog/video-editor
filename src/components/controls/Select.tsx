import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

interface SelectProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  compact?: boolean;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  compact,
}: SelectProps<T>) {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className={cn(
          'field cursor-pointer appearance-none pr-6',
          compact && 'h-6! border-transparent! bg-transparent! pl-1.5! text-[11px] hover:bg-hover!',
        )}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-panel-2">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
}
