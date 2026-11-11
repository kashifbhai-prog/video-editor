import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

// ---------------------------------------------------------------------------
// Reusable context menu: opens at a point, stays inside the viewport (flips /
// clamps), closes on outside click, Escape, scroll, resize and window blur.
// Keyboard: ↑ ↓ Home End move, Enter / Space activate, → opens a submenu,
// ← closes it. Items may be disabled (with a reason as tooltip).
// ---------------------------------------------------------------------------

export type MenuEntry =
  | {
      kind?: 'action';
      id: string;
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      disabled?: boolean;
      /** Shown as tooltip when disabled. */
      hint?: string;
      danger?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: 'submenu'; id: string; label: string; icon?: LucideIcon; disabled?: boolean; items: MenuEntry[] }
  | { kind: 'separator'; id: string };

const MARGIN = 6;

/** Clamps / flips a box of size w×h anchored at (x, y) into the viewport. */
export function placeInViewport(x: number, y: number, w: number, h: number, flipFromX?: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  if (left + w > vw - MARGIN) left = flipFromX !== undefined ? flipFromX - w : vw - MARGIN - w;
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
  let top = y;
  if (top + h > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - h);
  return { left, top, maxHeight: vh - MARGIN * 2 };
}

function MenuList({
  items,
  x,
  y,
  flipFromX,
  header,
  onClose,
  onBack,
  label,
  autoFocus = true,
}: {
  items: MenuEntry[];
  x: number;
  y: number;
  flipFromX?: number;
  header?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  label: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number; flip: number } | null>(null);
  const focusable = items.map((it, i) => (it.kind !== 'separator' && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Layout size (offset*), not getBoundingClientRect: the open animation scales the menu.
    // Re-placed whenever the content resizes (e.g. property values that load asynchronously).
    const place = () => setPos(placeInViewport(x, y, el.offsetWidth, el.offsetHeight, flipFromX));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y, flipFromX, items.length]);

  useEffect(() => {
    if (pos && autoFocus) ref.current?.focus();
  }, [pos, autoFocus]);

  const openSub = (i: number) => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSub({ index: i, x: r.right - 2, y: r.top - 5, flip: r.left + 2 });
  };

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.kind === 'separator' || it.disabled) return;
    if (it.kind === 'submenu') return openSub(i);
    onClose();
    it.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = focusable.indexOf(active);
    if (e.key === 'ArrowDown') setActive(focusable[(at + 1) % focusable.length] ?? -1);
    else if (e.key === 'ArrowUp') setActive(focusable[(at - 1 + focusable.length) % focusable.length] ?? -1);
    else if (e.key === 'Home') setActive(focusable[0] ?? -1);
    else if (e.key === 'End') setActive(focusable[focusable.length - 1] ?? -1);
    else if (e.key === 'Enter' || e.key === ' ') activate(active);
    else if (e.key === 'ArrowRight' && items[active]?.kind === 'submenu') openSub(active);
    else if (e.key === 'ArrowLeft' && onBack) onBack();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const subItem = sub ? items[sub.index] : undefined;
  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className="ctx-menu-anim fixed z-[1000] min-w-[230px] max-w-[340px] overflow-y-auto rounded-lg border border-line-strong bg-panel-2 py-1 text-[12px] text-fg shadow-2xl shadow-black/60 outline-none backdrop-blur"
        style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: x, top: y, visibility: 'hidden' }}
      >
        {header}
        {items.map((it, i) => {
          if (it.kind === 'separator') return <div key={it.id} role="separator" className="my-1 h-px bg-line" />;
          const Icon = it.icon;
          const isSub = it.kind === 'submenu';
          return (
            <div
              key={it.id}
              data-index={i}
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              aria-haspopup={isSub ? 'menu' : undefined}
              aria-expanded={isSub ? sub?.index === i : undefined}
              title={!isSub && it.disabled ? it.hint : undefined}
              onMouseEnter={() => {
                setActive(it.disabled ? -1 : i);
                if (isSub && !it.disabled) openSub(i);
                else setSub(null);
              }}
              onClick={() => activate(i)}
              className={cn(
                'mx-1 flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2',
                it.disabled ? 'text-fg-subtle/60' : active === i ? 'bg-accent text-white' : '',
                !it.disabled && !isSub && it.danger && active !== i && 'text-danger',
              )}
            >
              <span className="flex w-4 shrink-0 justify-center">{Icon ? <Icon size={13} /> : !isSub && it.checked ? '✓' : null}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {!isSub && it.shortcut && <span className={cn('ml-4 font-mono text-[10px]', active === i && !it.disabled ? 'text-white/80' : 'text-fg-subtle')}>{it.shortcut}</span>}
              {isSub && <ChevronRight size={12} className="ml-2 opacity-70" />}
            </div>
          );
        })}
      </div>
      {sub && subItem?.kind === 'submenu' && (
        <MenuList
          items={subItem.items}
          x={sub.x}
          y={sub.y}
          flipFromX={sub.flip}
          label={subItem.label}
          onClose={onClose}
          onBack={() => {
            setSub(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

/** A context menu at (x, y). Render it while open; `onClose` is called on any dismissal. */
export function ContextMenu({ x, y, items, header, onClose, label = 'Context menu' }: { x: number; y: number; items: MenuEntry[]; header?: ReactNode; onClose: () => void; label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Consume it: the editor's global Escape would also clear the selection.
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    const scroll = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
    });
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={root} data-testid="context-menu">
      <MenuList items={items} x={x} y={y} header={header} onClose={onClose} label={label} />
    </div>,
    document.body,
  );
}
