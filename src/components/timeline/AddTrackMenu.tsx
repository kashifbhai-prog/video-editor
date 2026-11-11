import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import type { TrackType } from '../../types';
import { TRACK_COLOR_VAR, TRACK_ICON } from './timelineConfig';

const OPTIONS: { type: TrackType; label: string; hint: string }[] = [
  { type: 'video', label: 'Video track', hint: 'Additional video layer' },
  { type: 'overlay', label: 'Overlay track', hint: 'Picture-in-picture, images' },
  { type: 'text', label: 'Text track', hint: 'Titles and captions' },
  { type: 'audio', label: 'Audio track', hint: 'Music, voice-over, SFX' },
];

/** Renders `trigger(open)` and a popover menu for adding a track. */
export function AddTrackMenu({
  trigger,
  className = 'inline-flex',
}: {
  trigger: (toggle: () => void, open: boolean) => ReactElement;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addTrack = useProjectStore((s) => s.addTrack);
  const setSelection = useUiStore((s) => s.setSelection);

  useEffect(() => {
    if (!anchor) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !wrapRef.current?.contains(e.target as Node)) setAnchor(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stop here so the global Escape handler doesn't also clear the selection.
      e.stopPropagation();
      setAnchor(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [anchor]);

  const toggle = () => setAnchor(anchor ? null : wrapRef.current?.getBoundingClientRect() ?? null);

  return (
    <span ref={wrapRef} className={className}>
      {trigger(toggle, !!anchor)}
      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[70] w-56 rounded-lg border border-line-strong bg-panel-2 p-1 shadow-2xl shadow-black/60"
            style={{
              left: Math.min(anchor.left, window.innerWidth - 232),
              top: anchor.top - 8,
              transform: 'translateY(-100%)',
            }}
          >
            {OPTIONS.map((o) => {
              const Icon = TRACK_ICON[o.type];
              return (
                <button
                  key={o.type}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const id = addTrack(o.type);
                    setSelection({ kind: 'track', id });
                    setAnchor(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded" style={{ background: `color-mix(in srgb, ${TRACK_COLOR_VAR[o.type]} 20%, transparent)`, color: TRACK_COLOR_VAR[o.type] }}>
                    <Icon size={13} />
                  </span>
                  <span>
                    <span className="block text-[12px] text-fg">{o.label}</span>
                    <span className="block text-[10px] text-fg-subtle">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
