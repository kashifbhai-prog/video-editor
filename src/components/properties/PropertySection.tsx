import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export function PropertySection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        {title}
        <ChevronDown size={13} className={cn('transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="space-y-3 px-3 pb-3.5">{children}</div>}
    </section>
  );
}

export function PropertyRow({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn(stacked ? 'space-y-1.5' : 'flex items-center justify-between gap-3')}>
      <span className="shrink-0 text-[11px] text-fg-muted">{label}</span>
      <div className={cn(stacked ? '' : 'min-w-0 flex-1 max-w-[150px]')}>{children}</div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="shrink-0 text-fg-subtle">{label}</span>
      <span className="min-w-0 break-words text-right text-fg">{value}</span>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-4 w-7 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
    </button>
  );
}
