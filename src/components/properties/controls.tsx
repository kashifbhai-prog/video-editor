import { ChevronLeft, ChevronRight, Diamond, RotateCcw } from 'lucide-react';
import { ANIMATABLE, animatedValue, hasKeyframes } from '../../engine/animation';
import { keyframeAt } from '../../engine/keyframes';
import { clipDuration, quantizeToFrame } from '../../engine/timelineModel';
import { usePlaybackStore } from '../../store/playbackStore';
import { useProjectStore } from '../../store/projectStore';
import { seekToKeyframe, setAnimatedValues, toggleKeyframe } from '../../services/advancedEditing';
import { cn } from '../../utils/cn';
import { parseCssColor, composeColor } from '../../utils/color';
import type { AnimatableProperty, Clip } from '../../types';
import { InlineTextInput } from '../controls/InlineTextInput';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** Shows a reset button while the value differs from this. */
  resetTo?: number;
  /** Extra controls next to the label (e.g. keyframe button). */
  accessory?: React.ReactNode;
}

/** Labelled range slider with a live value read-out. */
export function SliderRow({ label, value, min, max, step, format, onChange, disabled, resetTo, accessory }: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const canReset = resetTo !== undefined && Math.abs(value - resetTo) > step / 2;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1 text-[11px]">
        <span className="truncate text-fg-muted">{label}</span>
        <span className="flex items-center gap-1">
          {canReset && !disabled && (
            <button type="button" aria-label={`Reset ${label}`} title="Reset" onClick={() => onChange(resetTo!)} className="text-fg-subtle hover:text-fg">
              <RotateCcw size={10} />
            </button>
          )}
          <span className="font-mono text-fg">{format(value)}</span>
          {accessory}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range block w-full disabled:opacity-40"
        style={{ ['--fill' as string]: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

/** Seconds field: accepts "12.5" or "12.5s"; rejects invalid / negative input. */
export function SecondsField({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  return (
    <InlineTextInput
      aria-label={label}
      disabled={disabled}
      value={value.toFixed(2)}
      validate={(raw) => {
        const n = Number(raw.trim().replace(/s$/i, ''));
        return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
      }}
      onCommit={(v) => onCommit(Number(v))}
      className="field font-mono"
    />
  );
}

/**
 * Slider for an animatable property. Shows the value at the playhead
 * (interpolated when keyframed); the diamond adds / removes a keyframe at the
 * playhead; arrows jump between this property's keyframes.
 */
export function AnimatedSlider({ clip, prop, disabled, label }: { clip: Clip; prop: AnimatableProperty; disabled?: boolean; label?: string }) {
  const def = ANIMATABLE[prop];
  const fps = useProjectStore((s) => s.document.canvas.frameRate);
  const animated = hasKeyframes(clip, prop);
  // Only keyframed sliders follow the playhead (static ones never re-render on playback).
  const local = usePlaybackStore((s) =>
    animated ? Math.min(clipDuration(clip), Math.max(0, quantizeToFrame(s.timelineTime, fps) - clip.start)) : 0,
  );
  const inClip = usePlaybackStore((s) => s.timelineTime >= clip.start - 1e-6 && s.timelineTime <= clip.start + clipDuration(clip) + 1e-6);
  const value = animated ? animatedValue(clip, prop, local) : def.get(clip);
  const onKey = animated && !!keyframeAt(clip.keyframes?.[prop], local);
  const count = clip.keyframes?.[prop]?.length ?? 0;
  const neutral = prop === 'scale' || prop === 'opacity' || prop === 'volume' ? 1 : 0;

  return (
    <SliderRow
      label={label ?? def.label}
      value={value}
      min={def.uiMin}
      max={def.uiMax}
      step={def.step}
      format={def.format}
      disabled={disabled}
      resetTo={animated ? undefined : neutral}
      onChange={(v) => setAnimatedValues(clip.id, { [prop]: v }, `clip.${clip.id}.${prop}`)}
      accessory={
        <span className="flex items-center">
          {animated && (
            <button
              type="button"
              aria-label={`Previous ${def.label} keyframe`}
              onClick={() => seekToKeyframe(clip.id, -1, prop)}
              className="text-fg-subtle hover:text-fg"
            >
              <ChevronLeft size={12} />
            </button>
          )}
          <button
            type="button"
            aria-label={onKey ? `Remove ${def.label} keyframe` : `Add ${def.label} keyframe`}
            aria-pressed={onKey}
            title={
              !inClip
                ? 'Move the playhead over the clip to add keyframes'
                : onKey
                  ? 'Remove keyframe at playhead'
                  : `Add keyframe at playhead${count ? ` (${count} keyframe${count === 1 ? '' : 's'})` : ''}`
            }
            disabled={disabled || !inClip}
            onClick={() => toggleKeyframe(clip.id, prop)}
            className={cn('disabled:opacity-30', onKey ? 'text-accent' : animated ? 'text-fg-muted hover:text-fg' : 'text-fg-subtle hover:text-fg')}
          >
            <Diamond size={11} className={onKey ? 'fill-accent' : undefined} />
          </button>
          {animated && (
            <button
              type="button"
              aria-label={`Next ${def.label} keyframe`}
              onClick={() => seekToKeyframe(clip.id, 1, prop)}
              className="text-fg-subtle hover:text-fg"
            >
              <ChevronRight size={12} />
            </button>
          )}
        </span>
      }
    />
  );
}

/** Colour swatch + optional opacity. Writes #rrggbb or #rrggbbaa. */
export function ColorField({
  label,
  value,
  onChange,
  withAlpha,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (css: string) => void;
  withAlpha?: boolean;
  disabled?: boolean;
}) {
  const { hex, alpha } = parseCssColor(value);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-fg-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        {withAlpha && (
          <input
            type="range"
            aria-label={`${label} opacity`}
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            disabled={disabled}
            onChange={(e) => onChange(composeColor(hex, Number(e.target.value)))}
            className="range w-16"
            style={{ ['--fill' as string]: `${alpha * 100}%` }}
          />
        )}
        <input
          type="color"
          aria-label={label}
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(composeColor(e.target.value, alpha))}
          className="h-6 w-9 cursor-pointer rounded border border-line-strong bg-transparent p-0.5 disabled:opacity-40"
        />
      </div>
    </div>
  );
}

/** Small segmented toggle group. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-md border border-line-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-6 flex-1 items-center justify-center rounded text-[11px] transition-colors disabled:opacity-40',
            value === o.value ? 'bg-panel-3 text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
