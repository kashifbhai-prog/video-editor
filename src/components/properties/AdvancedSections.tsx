import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Maximize,
  Minimize,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { ANIMATABLE, ANIMATABLE_PROPS, animationDurations } from '../../engine/animation';
import {
  COLOR_ADJUSTMENTS,
  EFFECTS,
  effectDef,
  filterPresetById,
  FONT_FAMILIES,
  IN_ANIMATIONS,
  isNeutralColor,
  NEUTRAL_COLOR,
  OUT_ANIMATIONS,
} from '../../engine/catalog';
import { EASING_LABEL } from '../../engine/keyframes';
import { clipDuration } from '../../engine/timelineModel';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { previewEngine } from '../../engine/previewEngine';
import {
  addEffect,
  applyFilter,
  clearKeyframes,
  deleteKeyframe,
  editKeyframe,
  fitClip,
  moveEffect,
  removeEffect,
  resetColor,
  resetTransform,
  retimeKeyframe,
  setAnimation,
  setColorValue,
  setFilterIntensity,
  setReversed,
  setSpeed,
  updateEffect,
  updateTextContent,
  updateTextStyle,
} from '../../services/advancedEditing';
import { cn } from '../../utils/cn';
import type { AnimatableProperty, Clip, EasingType, EffectType, InAnimationType, OutAnimationType, TextStyle } from '../../types';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { PropertyRow, PropertySection, Switch } from './PropertySection';
import { AnimatedSlider, ColorField, SecondsField, Segmented, SliderRow } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const secs = (v: number) => `${v.toFixed(2)}s`;
const key = (clip: Clip, prop: string) => `clip.${clip.id}.${prop}`;

// ---- Transform -------------------------------------------------------------------------

export function TransformSection({ clip, locked, isText }: { clip: Clip; locked: boolean; isText: boolean }) {
  const update = useProjectStore((s) => s.updateClip);
  const t = clip.transform;
  const crop = clip.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const setCrop = (side: keyof typeof crop, v: number) => update(clip.id, { crop: { ...crop, [side]: v } }, key(clip, `crop.${side}`));
  const fit = clip.fit ?? 'contain';
  return (
    <PropertySection title="Transform">
      <AnimatedSlider clip={clip} prop="x" disabled={locked} />
      <AnimatedSlider clip={clip} prop="y" disabled={locked} />
      <AnimatedSlider clip={clip} prop="scale" disabled={locked} />
      <AnimatedSlider clip={clip} prop="rotation" disabled={locked} />
      <AnimatedSlider clip={clip} prop="opacity" disabled={locked} />
      <div className="flex gap-1.5">
        <Button
          className="flex-1 px-1!"
          aria-pressed={!!t.flipH}
          variant={t.flipH ? 'primary' : 'secondary'}
          disabled={locked}
          onClick={() => update(clip.id, { transform: { ...t, flipH: !t.flipH } })}
        >
          <FlipHorizontal2 size={13} /> Flip H
        </Button>
        <Button
          className="flex-1 px-1!"
          aria-pressed={!!t.flipV}
          variant={t.flipV ? 'primary' : 'secondary'}
          disabled={locked}
          onClick={() => update(clip.id, { transform: { ...t, flipV: !t.flipV } })}
        >
          <FlipVertical2 size={13} /> Flip V
        </Button>
      </div>
      {!isText && (
        <div className="flex gap-1.5">
          <Button className="flex-1 px-1!" aria-pressed={fit === 'contain'} disabled={locked} onClick={() => fitClip(clip.id, 'contain')} title="Whole frame visible, centred">
            <Minimize size={13} /> Fit canvas
          </Button>
          <Button className="flex-1 px-1!" aria-pressed={fit === 'cover'} disabled={locked} onClick={() => fitClip(clip.id, 'cover')} title="Fill the canvas, edges cropped">
            <Maximize size={13} /> Fill canvas
          </Button>
        </div>
      )}
      <SliderRow
        label="Anchor X"
        value={t.anchorX ?? 0.5}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        resetTo={0.5}
        disabled={locked}
        onChange={(anchorX) => update(clip.id, { transform: { ...t, anchorX } }, key(clip, 'anchorX'))}
      />
      <SliderRow
        label="Anchor Y"
        value={t.anchorY ?? 0.5}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        resetTo={0.5}
        disabled={locked}
        onChange={(anchorY) => update(clip.id, { transform: { ...t, anchorY } }, key(clip, 'anchorY'))}
      />
      {!isText && (
        <div className="space-y-3 rounded-md border border-line p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Crop</div>
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <SliderRow
              key={side}
              label={`Crop ${side}`}
              value={crop[side]}
              min={0}
              max={0.9}
              step={0.005}
              format={pct}
              resetTo={0}
              disabled={locked}
              onChange={(v) => setCrop(side, v)}
            />
          ))}
        </div>
      )}
      <Button variant="ghost" className="w-full" disabled={locked} onClick={() => resetTransform(clip.id)}>
        <RotateCcw size={12} /> Reset transform
      </Button>
    </PropertySection>
  );
}

// ---- Entrance / exit animation -------------------------------------------------------------

export function AnimationSection({ clip, locked, isText }: { clip: Clip; locked: boolean; isText: boolean }) {
  const a = clip.animation;
  const { inDur, outDur } = animationDurations(clip);
  const maxDur = Math.max(0.1, Math.min(5, clipDuration(clip)));
  return (
    <PropertySection title="Animation" defaultOpen={isText}>
      <PropertyRow label="In">
        <Select<InAnimationType>
          ariaLabel="In animation"
          value={a?.in.type ?? 'none'}
          options={IN_ANIMATIONS.filter((o) => isText || !o.textOnly)}
          onChange={(type) => setAnimation(clip.id, { in: { type } })}
        />
      </PropertyRow>
      {a && a.in.type !== 'none' && (
        <SliderRow
          label="In duration"
          value={a.in.duration}
          min={0.1}
          max={maxDur}
          step={0.05}
          format={() => secs(inDur)}
          disabled={locked}
          onChange={(duration) => setAnimation(clip.id, { in: { duration } }, key(clip, 'anim.in'))}
        />
      )}
      <PropertyRow label="Out">
        <Select<OutAnimationType>
          ariaLabel="Out animation"
          value={a?.out.type ?? 'none'}
          options={OUT_ANIMATIONS}
          onChange={(type) => setAnimation(clip.id, { out: { type } })}
        />
      </PropertyRow>
      {a && a.out.type !== 'none' && (
        <SliderRow
          label="Out duration"
          value={a.out.duration}
          min={0.1}
          max={maxDur}
          step={0.05}
          format={() => secs(outDur)}
          disabled={locked}
          onChange={(duration) => setAnimation(clip.id, { out: { duration } }, key(clip, 'anim.out'))}
        />
      )}
    </PropertySection>
  );
}

// ---- Speed -------------------------------------------------------------------------------------

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function SpeedSection({ clip, locked, canReverse }: { clip: Clip; locked: boolean; canReverse: boolean }) {
  return (
    <PropertySection title="Speed">
      <SliderRow
        label="Speed"
        value={clip.speed}
        min={0.25}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        resetTo={1}
        disabled={locked}
        onChange={(v) => setSpeed(clip.id, Math.round(v * 100) / 100, key(clip, 'speed'))}
      />
      <PropertyRow label="Preset">
        <Select<number>
          ariaLabel="Clip speed"
          value={clip.speed}
          options={[
            ...(SPEED_PRESETS.some((p) => Math.abs(p - clip.speed) < 1e-6) ? [] : [{ value: clip.speed, label: `${clip.speed}× (custom)` }]),
            ...SPEED_PRESETS.map((p) => ({ value: p, label: `${p}×${p < 1 ? ' slow' : p > 1 ? ' fast' : ''}` })),
          ]}
          onChange={(v) => !locked && setSpeed(clip.id, v)}
        />
      </PropertyRow>
      <p className="text-[10px] leading-relaxed text-fg-subtle">
        {clip.speed < 1 ? 'Slow motion' : clip.speed > 1 ? 'Fast motion' : 'Normal speed'} · length {secs(clipDuration(clip))}. Audio keeps its pitch.
      </p>
      {canReverse && (
        <>
          <PropertyRow label="Reverse">
            <div className="flex justify-end">
              <Switch label="Reverse" checked={!!clip.reversed} onChange={(v) => !locked && setReversed(clip.id, v)} />
            </div>
          </PropertyRow>
          {clip.reversed && (
            <p className="text-[10px] leading-relaxed text-warning">
              Reverse preview is seek-driven (browsers can't play video backwards): it may stutter on long-GOP files, and audio is muted.
            </p>
          )}
        </>
      )}
    </PropertySection>
  );
}

// ---- Colour: filter + adjustments ---------------------------------------------------------------

export function ColorSection({ clip, locked }: { clip: Clip; locked: boolean }) {
  const color = { ...NEUTRAL_COLOR, ...clip.color };
  const preset = filterPresetById(clip.filter?.presetId);
  const selectSection = useUiStore((s) => s.selectSection);
  const activeSection = useUiStore((s) => s.activeSection);
  return (
    <PropertySection title="Adjust">
      <div className="space-y-2 rounded-md border border-line p-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-muted">Filter</span>
          {preset ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: preset.swatch }} />
              <span className="text-fg">{preset.name}</span>
              <button type="button" aria-label="Remove filter" disabled={locked} onClick={() => applyFilter(null, [clip.id])} className="text-fg-subtle hover:text-danger">
                <X size={12} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => activeSection !== 'filters' && selectSection('filters')}
            >
              Browse filters
            </button>
          )}
        </div>
        {preset && (
          <SliderRow
            label="Filter intensity"
            value={clip.filter!.intensity}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            resetTo={1}
            disabled={locked}
            onChange={(v) => setFilterIntensity(clip.id, v, key(clip, 'filter'))}
          />
        )}
      </div>
      {COLOR_ADJUSTMENTS.map(({ key: k, label, min, max }) => (
        <SliderRow
          key={k}
          label={label}
          value={color[k]}
          min={min}
          max={max}
          step={0.01}
          format={min < 0 ? signedPct : pct}
          resetTo={0}
          disabled={locked}
          onChange={(v) => setColorValue(clip.id, k, v, key(clip, `color.${k}`))}
        />
      ))}
      <Button variant="ghost" className="w-full" disabled={locked || isNeutralColor(clip.color)} onClick={() => resetColor(clip.id)}>
        <RotateCcw size={12} /> Reset all adjustments
      </Button>
    </PropertySection>
  );
}

// ---- Effects ------------------------------------------------------------------------------------

export function EffectsSection({ clip, locked }: { clip: Clip; locked: boolean }) {
  const effects = clip.effects ?? [];
  const [adding, setAdding] = useState<EffectType | ''>('');
  return (
    <PropertySection title={`Effects${effects.length ? ` (${effects.length})` : ''}`}>
      {effects.length === 0 && <p className="text-[11px] text-fg-subtle">No effects. Add one below or from the Effects library.</p>}
      {effects.map((fx, i) => (
        <div key={fx.id} className={cn('space-y-2 rounded-md border border-line p-2', !fx.enabled && 'opacity-60')} data-effect-type={fx.type}>
          <div className="flex items-center gap-1.5">
            <Switch label={`Enable ${effectDef(fx.type).name}`} checked={fx.enabled} onChange={(enabled) => !locked && updateEffect(clip.id, fx.id, { enabled })} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-fg">{effectDef(fx.type).name}</span>
            <button type="button" aria-label="Move effect up" disabled={locked || i === 0} onClick={() => moveEffect(clip.id, fx.id, -1)} className="text-fg-subtle hover:text-fg disabled:opacity-30">
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              aria-label="Move effect down"
              disabled={locked || i === effects.length - 1}
              onClick={() => moveEffect(clip.id, fx.id, 1)}
              className="text-fg-subtle hover:text-fg disabled:opacity-30"
            >
              <ArrowDown size={12} />
            </button>
            <button type="button" aria-label={`Remove ${effectDef(fx.type).name}`} disabled={locked} onClick={() => removeEffect(clip.id, fx.id)} className="text-fg-subtle hover:text-danger">
              <Trash2 size={12} />
            </button>
          </div>
          <SliderRow
            label="Intensity"
            value={fx.intensity}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            disabled={locked || !fx.enabled}
            onChange={(intensity) => updateEffect(clip.id, fx.id, { intensity }, key(clip, `fx.${fx.id}`))}
          />
        </div>
      ))}
      <div className="flex gap-1.5">
        <Select<EffectType | ''>
          className="flex-1"
          ariaLabel="Effect to add"
          value={adding}
          options={[{ value: '', label: 'Choose effect…' }, ...EFFECTS.map((e) => ({ value: e.type, label: e.name }))]}
          onChange={setAdding}
        />
        <Button
          disabled={locked || !adding}
          onClick={() => {
            if (adding) addEffect(adding, [clip.id]);
            setAdding('');
          }}
        >
          Add
        </Button>
      </div>
    </PropertySection>
  );
}

// ---- Keyframes list ------------------------------------------------------------------------------

const EASINGS = (Object.keys(EASING_LABEL) as EasingType[]).map((e) => ({ value: e, label: EASING_LABEL[e] }));

export function KeyframesSection({ clip, locked }: { clip: Clip; locked: boolean }) {
  const props = ANIMATABLE_PROPS.filter((p) => (clip.keyframes?.[p]?.length ?? 0) > 0);
  if (!props.length) return null;
  const seek = (local: number) => {
    useUiStore.getState().showTimeline();
    previewEngine.seek(clip.start + local);
  };
  return (
    <PropertySection title="Keyframes">
      {props.map((prop: AnimatableProperty) => {
        const def = ANIMATABLE[prop];
        const list = clip.keyframes![prop]!;
        return (
          <div key={prop} className="space-y-1.5" data-keyframe-prop={prop}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-fg">
                {def.label} <span className="text-fg-subtle">({list.length})</span>
              </span>
              <button type="button" disabled={locked} onClick={() => clearKeyframes(clip.id, prop)} className="text-[10px] text-fg-subtle hover:text-danger">
                Clear
              </button>
            </div>
            {list.map((k) => (
              <div key={k.id} className="grid grid-cols-[56px_1fr_84px_16px] items-center gap-1" data-keyframe-id={k.id}>
                <SecondsField label={`${def.label} keyframe time`} value={k.time} disabled={locked} onCommit={(v) => retimeKeyframe(clip.id, prop, k.id, v)} />
                <button
                  type="button"
                  title="Jump to keyframe"
                  onClick={() => seek(k.time)}
                  className="truncate rounded px-1 text-left font-mono text-[11px] text-fg hover:bg-hover"
                >
                  {def.format(k.value)}
                </button>
                <Select<EasingType>
                  compact
                  ariaLabel={`${def.label} keyframe easing`}
                  value={k.easing}
                  options={EASINGS}
                  onChange={(easing) => editKeyframe(clip.id, prop, k.id, { easing })}
                />
                <button type="button" aria-label={`Delete ${def.label} keyframe`} disabled={locked} onClick={() => deleteKeyframe(clip.id, prop, k.id)} className="text-fg-subtle hover:text-danger">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-[10px] leading-relaxed text-fg-subtle">
        Times are relative to the clip start. Easing shapes the motion towards the next keyframe. Drag the diamonds on the timeline clip to move keyframes.
      </p>
    </PropertySection>
  );
}

// ---- Text ------------------------------------------------------------------------------------------

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }));

export function TextSection({ clip, locked }: { clip: Clip; locked: boolean }) {
  const text = clip.text!;
  const s = text.style;
  const [draft, setDraft] = useState<string | null>(null);
  const set = (patch: Partial<TextStyle>, k?: string) => updateTextStyle(clip.id, patch, k ? key(clip, `text.${k}`) : undefined);
  return (
    <PropertySection title="Text">
      <textarea
        aria-label="Text content"
        dir="auto"
        rows={3}
        disabled={locked}
        value={draft ?? text.content}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() && draft !== text.content) updateTextContent(clip.id, draft);
          setDraft(null);
        }}
        className="field h-auto! resize-y py-1.5 leading-snug"
      />
      <PropertyRow label="Font">
        <Select ariaLabel="Font family" value={s.fontFamily} options={FONT_FAMILIES} onChange={(fontFamily) => set({ fontFamily })} />
      </PropertyRow>
      <SliderRow label="Size" value={s.fontSize} min={12} max={300} step={1} format={(v) => `${Math.round(v)}px`} disabled={locked} onChange={(fontSize) => set({ fontSize }, 'size')} />
      <div className="flex items-center gap-1.5">
        <Select<number> className="flex-1" ariaLabel="Font weight" value={s.fontWeight} options={WEIGHTS} onChange={(fontWeight) => set({ fontWeight })} />
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={s.fontWeight >= 700}
          disabled={locked}
          onClick={() => set({ fontWeight: s.fontWeight >= 700 ? 400 : 700 })}
          className={cn('flex h-7 w-7 items-center justify-center rounded border border-line-strong', s.fontWeight >= 700 ? 'bg-panel-3 text-fg' : 'text-fg-muted')}
        >
          <Bold size={13} />
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={s.italic}
          disabled={locked}
          onClick={() => set({ italic: !s.italic })}
          className={cn('flex h-7 w-7 items-center justify-center rounded border border-line-strong', s.italic ? 'bg-panel-3 text-fg' : 'text-fg-muted')}
        >
          <Italic size={13} />
        </button>
      </div>
      <Segmented
        ariaLabel="Alignment"
        value={s.align}
        disabled={locked}
        onChange={(align) => set({ align })}
        options={[
          { value: 'left', label: <AlignLeft size={13} />, title: 'Align left' },
          { value: 'center', label: <AlignCenter size={13} />, title: 'Align centre' },
          { value: 'right', label: <AlignRight size={13} />, title: 'Align right' },
        ]}
      />
      <PropertyRow label="Direction">
        <Select
          ariaLabel="Text direction"
          value={s.direction}
          options={[
            { value: 'auto', label: 'Auto (detect)' },
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
          onChange={(direction) => set({ direction })}
        />
      </PropertyRow>
      <ColorField label="Text colour" value={s.color} disabled={locked} onChange={(color) => set({ color }, 'color')} />
      <PropertyRow label="Background">
        <div className="flex justify-end">
          <Switch label="Background" checked={!!s.background} onChange={(on) => !locked && set({ background: on ? '#000000b3' : null })} />
        </div>
      </PropertyRow>
      {s.background && <ColorField label="Background colour" withAlpha value={s.background} disabled={locked} onChange={(background) => set({ background }, 'bg')} />}
      <SliderRow label="Letter spacing" value={s.letterSpacing} min={-10} max={40} step={0.5} format={(v) => `${v}px`} resetTo={0} disabled={locked} onChange={(letterSpacing) => set({ letterSpacing }, 'ls')} />
      <SliderRow label="Line spacing" value={s.lineHeight} min={0.8} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} resetTo={1.2} disabled={locked} onChange={(lineHeight) => set({ lineHeight }, 'lh')} />
      <SliderRow label="Outline" value={s.outlineWidth} min={0} max={20} step={0.5} format={(v) => `${v}px`} resetTo={0} disabled={locked} onChange={(outlineWidth) => set({ outlineWidth }, 'ow')} />
      {s.outlineWidth > 0 && <ColorField label="Outline colour" value={s.outlineColor} disabled={locked} onChange={(outlineColor) => set({ outlineColor }, 'oc')} />}
      <SliderRow label="Shadow blur" value={s.shadowBlur} min={0} max={40} step={1} format={(v) => `${v}px`} resetTo={0} disabled={locked} onChange={(shadowBlur) => set({ shadowBlur }, 'sb')} />
      {(s.shadowBlur > 0 || s.shadowOffsetX !== 0 || s.shadowOffsetY !== 0) && (
        <>
          <SliderRow label="Shadow X" value={s.shadowOffsetX} min={-30} max={30} step={1} format={(v) => `${v}px`} resetTo={0} disabled={locked} onChange={(shadowOffsetX) => set({ shadowOffsetX }, 'sx')} />
          <SliderRow label="Shadow Y" value={s.shadowOffsetY} min={-30} max={30} step={1} format={(v) => `${v}px`} resetTo={0} disabled={locked} onChange={(shadowOffsetY) => set({ shadowOffsetY }, 'sy')} />
          <ColorField label="Shadow colour" withAlpha value={s.shadowColor} disabled={locked} onChange={(shadowColor) => set({ shadowColor }, 'sc')} />
        </>
      )}
    </PropertySection>
  );
}
