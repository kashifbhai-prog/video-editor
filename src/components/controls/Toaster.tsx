import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import type { ToastTone } from '../../types';
import { cn } from '../../utils/cn';

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-md border border-line-strong bg-panel-3 px-3 py-2 text-[12px] shadow-xl shadow-black/50"
          >
            <Icon size={15} className={cn('mt-px shrink-0', TONE_CLASS[t.tone])} />
            <span className="leading-snug">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="ml-1 shrink-0 rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
