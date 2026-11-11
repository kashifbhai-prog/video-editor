import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { cn } from '../../utils/cn';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, active, size = 'md', tooltipSide = 'bottom', className, children, ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-6 min-w-6' : 'h-7 min-w-7';
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex items-center justify-center gap-1 rounded-md px-1 text-fg-muted transition-colors',
          'hover:bg-hover hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-fg-muted',
          active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent-hover',
          dim,
          className,
        )}
        {...rest}
      >
        <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} />
        {children}
      </button>
    </Tooltip>
  );
});
