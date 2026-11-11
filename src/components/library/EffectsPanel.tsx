import { useState } from 'react';
import { EFFECTS, type EffectDef } from '../../engine/catalog';
import { addEffect } from '../../services/advancedEditing';
import { cn } from '../../utils/cn';
import { LIBRARY_DRAG_MIME, setDraggedLibraryItem } from '../timeline/dragStore';
import { PanelHeader, PanelHint, useSelectedClipIds } from './PanelChrome';

const CATEGORIES = ['All', 'Blur', 'Light', 'Texture', 'Distort'] as const;

/** Decorative CSS approximation of each effect on a sample gradient (the real effect runs in WebGL). */
const SAMPLE_STYLE: Record<EffectDef['type'], React.CSSProperties> = {
  blur: { filter: 'blur(2px)' },
  gaussianBlur: { filter: 'blur(4px)' },
  motionBlur: { filter: 'blur(1.5px)', transform: 'scaleX(1.15)' },
  glow: { filter: 'brightness(1.35) saturate(1.2) drop-shadow(0 0 6px #fff)' },
  vignette: { boxShadow: 'inset 0 0 22px 10px rgba(0,0,0,0.85)' },
  sharpen: { filter: 'contrast(1.4)' },
  noise: { filter: 'contrast(1.2)' },
  filmGrain: { filter: 'sepia(0.3) contrast(1.1)' },
  pixelate: { imageRendering: 'pixelated' },
  glitch: { filter: 'hue-rotate(60deg) saturate(1.6)' },
  rgbSplit: { filter: 'drop-shadow(3px 0 0 rgba(255,0,0,0.7)) drop-shadow(-3px 0 0 rgba(0,160,255,0.7))' },
  chromaticAberration: { filter: 'drop-shadow(2px 1px 0 rgba(255,0,80,0.6)) drop-shadow(-2px -1px 0 rgba(0,200,255,0.6))' },
};

export function EffectsPanel() {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('All');
  const selected = useSelectedClipIds();
  const list = EFFECTS.filter((e) => cat === 'All' || e.category === cat);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Effects" count={EFFECTS.length} />
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Effect categories">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className={cn('h-6 rounded px-2 text-[11px]', cat === c ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHint>
          {selected.length
            ? `Click an effect to add it to the ${selected.length} selected clip${selected.length === 1 ? '' : 's'}, or drag it onto any clip.`
            : 'Select a clip, then click an effect – or drag an effect onto a clip on the timeline.'}{' '}
          Adjust or remove applied effects in the Properties panel.
        </PanelHint>
        <div className="grid grid-cols-2 gap-2 px-3 pt-2.5">
          {list.map((def) => (
            <button
              key={def.type}
              type="button"
              draggable
              aria-label={`Effect ${def.name}`}
              title={`${def.name} – ${def.description}`}
              onClick={() => addEffect(def.type)}
              onDragStart={(e) => {
                e.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify({ kind: 'effect', type: def.type }));
                e.dataTransfer.effectAllowed = 'copy';
                setDraggedLibraryItem({ kind: 'effect', type: def.type });
              }}
              onDragEnd={() => setDraggedLibraryItem(null)}
              className="group space-y-1 rounded-md p-1 text-left transition-colors hover:bg-hover"
            >
              <div className="relative aspect-video overflow-hidden rounded-md bg-black">
                <div
                  className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,#ffe8a3_0,#ff8a4c_22%,#6c3cff_55%,#101828_90%)]"
                  style={SAMPLE_STYLE[def.type]}
                />
              </div>
              <div className="truncate px-0.5 text-[11px] text-fg">{def.name}</div>
              <div className="truncate px-0.5 text-[10px] text-fg-subtle">{def.category}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
