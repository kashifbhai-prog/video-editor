import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: Side;
  children: ReactElement;
  disabled?: boolean;
}

const TRANSFORM: Record<Side, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
};

/**
 * Lightweight tooltip rendered in a portal so it is never clipped by
 * scrollable panels. Wraps its child in an inline-flex span.
 */
export function Tooltip({ label, shortcut, side = 'bottom', children, disabled }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const map: Record<Side, { x: number; y: number }> = {
        top: { x: r.left + r.width / 2, y: r.top - gap },
        bottom: { x: r.left + r.width / 2, y: r.bottom + gap },
        left: { x: r.left - gap, y: r.top + r.height / 2 },
        right: { x: r.right + gap, y: r.top + r.height / 2 },
      };
      setPos(map[side]);
    }, 350);
  }, [side]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);

  // Don't let a pending show-timer fire after the trigger is removed.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        !disabled &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] flex items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-[#0b0c0e] px-2 py-1 text-[11px] text-fg shadow-lg shadow-black/40"
            style={{ left: pos.x, top: pos.y, transform: TRANSFORM[side] }}
          >
            {label}
            {shortcut && <span className="font-mono text-[10px] text-fg-subtle">{shortcut}</span>}
          </div>,
          document.body,
        )}
    </span>
  );
}
