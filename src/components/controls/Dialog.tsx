import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ title, onClose, children, footer, width = 460 }: DialogProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/60"
        style={{ maxWidth: width }}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
