import type { AnimatableProperty, Clip, ClipAnimation } from '../types';
import { DEFAULT_ANIMATION_DURATION } from './catalog';
import { valueAt } from './keyframes';
import { clipDuration } from './timelineModel';

// ---------------------------------------------------------------------------
// Animatable property registry + per-frame clip evaluation.
//
// To make a new property animatable: add it to AnimatableProperty, give it a
// registry entry (how to read / write its static value) and read it through
// `animatedValue` where it is rendered. Keyframe storage, interpolation, the
// properties-panel keyframe buttons and timeline markers all work generically.
// ---------------------------------------------------------------------------

export interface AnimatableDef {
  prop: AnimatableProperty;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Slider range (can be narrower than the valid range). */
  uiMin: number;
  uiMax: number;
  format: (v: number) => string;
  /** Static (non-animated) value stored on the clip. */
  get: (c: Clip) => number;
  /** Patch that writes a static value. */
  set: (c: Clip, v: number) => Partial<Clip>;
  applies: 'visual' | 'audio';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const ANIMATABLE: Record<AnimatableProperty, AnimatableDef> = {
  x: {
    prop: 'x',
    label: 'Position X',
    min: -3,
    max: 3,
    step: 0.005,
    uiMin: -1,
    uiMax: 1,
    format: pct,
    get: (c) => c.transform.x,
    set: (c, x) => ({ transform: { ...c.transform, x } }),
    applies: 'visual',
  },
  y: {
    prop: 'y',
    label: 'Position Y',
    min: -3,
    max: 3,
    step: 0.005,
    uiMin: -1,
    uiMax: 1,
    format: pct,
    get: (c) => c.transform.y,
    set: (c, y) => ({ transform: { ...c.transform, y } }),
    applies: 'visual',
  },
  scale: {
    prop: 'scale',
    label: 'Scale',
    min: 0.05,
    max: 5,
    step: 0.01,
    uiMin: 0.1,
    uiMax: 3,
    format: pct,
    get: (c) => c.transform.scale,
    set: (c, scale) => ({ transform: { ...c.transform, scale } }),
    applies: 'visual',
  },
  rotation: {
    prop: 'rotation',
    label: 'Rotation',
    min: -3600,
    max: 3600,
    step: 1,
    uiMin: -180,
    uiMax: 180,
    format: (v) => `${Math.round(v)}°`,
    get: (c) => c.transform.rotation ?? 0,
    set: (c, rotation) => ({ transform: { ...c.transform, rotation } }),
    applies: 'visual',
  },
  opacity: {
    prop: 'opacity',
    label: 'Opacity',
    min: 0,
    max: 1,
    step: 0.01,
    uiMin: 0,
    uiMax: 1,
    format: pct,
    get: (c) => c.opacity,
    set: (_c, opacity) => ({ opacity }),
    applies: 'visual',
  },
  volume: {
    prop: 'volume',
    label: 'Volume',
    min: 0,
    max: 1,
    step: 0.01,
    uiMin: 0,
    uiMax: 1,
    format: pct,
    get: (c) => c.volume,
    set: (_c, volume) => ({ volume }),
    applies: 'audio',
  },
};

export const ANIMATABLE_PROPS = Object.keys(ANIMATABLE) as AnimatableProperty[];

export const clampProp = (prop: AnimatableProperty, v: number) => Math.min(ANIMATABLE[prop].max, Math.max(ANIMATABLE[prop].min, v));

export const hasKeyframes = (clip: Clip, prop: AnimatableProperty) => (clip.keyframes?.[prop]?.length ?? 0) > 0;

/** Value of `prop` at clip-local time `local` (keyframed or static). */
export function animatedValue(clip: Clip, prop: AnimatableProperty, local: number): number {
  return valueAt(clip.keyframes?.[prop], local, ANIMATABLE[prop].get(clip));
}

export interface ResolvedVisual {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
  anchorX: number;
  anchorY: number;
  /** Text typewriter: characters visible (null = all). */
  visibleChars: number | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
/** Overshoots past 1 then settles – "pop". */
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

export const DEFAULT_ANIMATION: ClipAnimation = {
  in: { type: 'none', duration: DEFAULT_ANIMATION_DURATION },
  out: { type: 'none', duration: DEFAULT_ANIMATION_DURATION },
};

/** Entrance / exit durations, scaled down so they never overlap on short clips. */
export function animationDurations(clip: Clip): { inDur: number; outDur: number } {
  const a = clip.animation;
  if (!a) return { inDur: 0, outDur: 0 };
  const total = clipDuration(clip);
  let inDur = a.in.type === 'none' ? 0 : Math.max(0.01, a.in.duration);
  let outDur = a.out.type === 'none' ? 0 : Math.max(0.01, a.out.duration);
  if (inDur + outDur > total && inDur + outDur > 0) {
    const k = total / (inDur + outDur);
    inDur *= k;
    outDur *= k;
  }
  return { inDur, outDur };
}

/** Fully resolved visual state of a clip at timeline time `t` (keyframes + presets). */
export function resolveVisual(clip: Clip, t: number): ResolvedVisual {
  const local = t - clip.start;
  const tr = clip.transform;
  const r: ResolvedVisual = {
    x: animatedValue(clip, 'x', local),
    y: animatedValue(clip, 'y', local),
    scale: Math.max(0, animatedValue(clip, 'scale', local)),
    rotation: animatedValue(clip, 'rotation', local),
    opacity: clamp01(animatedValue(clip, 'opacity', local)),
    flipH: !!tr.flipH,
    flipV: !!tr.flipV,
    anchorX: tr.anchorX ?? 0.5,
    anchorY: tr.anchorY ?? 0.5,
    visibleChars: null,
  };
  const a = clip.animation;
  if (!a) return r;
  const { inDur, outDur } = animationDurations(clip);
  const total = clipDuration(clip);

  if (inDur > 0 && local < inDur) {
    const p = clamp01(local / inDur);
    const e = easeOutCubic(p);
    switch (a.in.type) {
      case 'fadeIn':
        r.opacity *= e;
        break;
      case 'slideIn':
        r.x -= (1 - e) * 0.35;
        r.opacity *= e;
        break;
      case 'zoomIn':
        r.scale *= 0.3 + 0.7 * e;
        r.opacity *= e;
        break;
      case 'popUp':
        r.scale *= Math.max(0, easeOutBack(p));
        r.opacity *= clamp01(p * 3);
        break;
      case 'typewriter':
        if (clip.text) r.visibleChars = Math.floor(Array.from(clip.text.content).length * p);
        break;
    }
  }
  const remaining = total - local;
  if (outDur > 0 && remaining < outDur) {
    const q = clamp01(remaining / outDur);
    const e = easeOutCubic(q);
    switch (a.out.type) {
      case 'fadeOut':
        r.opacity *= e;
        break;
      case 'slideOut':
        r.x += (1 - e) * 0.35;
        r.opacity *= e;
        break;
      case 'zoomOut':
        r.scale *= 0.3 + 0.7 * e;
        r.opacity *= e;
        break;
    }
  }
  return r;
}

export const resolveVolume = (clip: Clip, t: number) => clamp01(animatedValue(clip, 'volume', t - clip.start));

/** Sorted, de-duplicated keyframe times (clip-local) across all properties – for timeline markers. */
export function keyframeTimes(clip: Clip): number[] {
  const out: number[] = [];
  for (const list of Object.values(clip.keyframes ?? {})) {
    for (const k of list ?? []) if (!out.some((t) => Math.abs(t - k.time) < 1e-3)) out.push(k.time);
  }
  return out.sort((a, b) => a - b);
}
