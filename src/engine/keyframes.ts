import type { EasingType, Keyframe } from '../types';

// ---------------------------------------------------------------------------
// Keyframe engine – pure functions over sorted keyframe lists. Property
// agnostic: any numeric property can be animated by giving it a Keyframe[]
// (see the registry in engine/animation.ts).
//
// Semantics:
//  * Before the first keyframe the value holds at the first keyframe's value,
//    after the last it holds at the last one's (no extrapolation).
//  * The easing stored on a keyframe shapes the segment that STARTS there.
// ---------------------------------------------------------------------------

/** Two keyframes closer than this (seconds) are considered the same position. */
export const KEYFRAME_EPS = 1e-3;

export const EASINGS: Record<EasingType, (p: number) => number> = {
  linear: (p) => p,
  easeIn: (p) => p * p * p,
  easeOut: (p) => 1 - (1 - p) ** 3,
  easeInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
};

export const EASING_LABEL: Record<EasingType, string> = {
  linear: 'Linear',
  easeIn: 'Ease in',
  easeOut: 'Ease out',
  easeInOut: 'Ease in-out',
};

const byTime = (a: Keyframe, b: Keyframe) => a.time - b.time;

/** Interpolated value at `time`; `fallback` when there are no keyframes. */
export function valueAt(kfs: readonly Keyframe[] | undefined, time: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  if (time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  // Binary search for the segment [lo, lo+1] containing `time`.
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  const p = EASINGS[a.easing]((time - a.time) / span);
  return a.value + (b.value - a.value) * p;
}

export function keyframeAt(kfs: readonly Keyframe[] | undefined, time: number): Keyframe | undefined {
  return kfs?.find((k) => Math.abs(k.time - time) < KEYFRAME_EPS);
}

/** Adds a keyframe at `time`, or updates the value of the one already there. */
export function upsertKeyframe(
  kfs: readonly Keyframe[] | undefined,
  time: number,
  value: number,
  makeId: () => string,
  easing?: EasingType,
): Keyframe[] {
  const list = kfs ? [...kfs] : [];
  const i = list.findIndex((k) => Math.abs(k.time - time) < KEYFRAME_EPS);
  if (i >= 0) list[i] = { ...list[i], value, easing: easing ?? list[i].easing };
  else list.push({ id: makeId(), time: Math.max(0, time), value, easing: easing ?? 'linear' });
  return list.sort(byTime);
}

export function removeKeyframe(kfs: readonly Keyframe[], id: string): Keyframe[] {
  return kfs.filter((k) => k.id !== id);
}

/**
 * Moves a keyframe in time. If another keyframe already sits at the target the
 * moved one replaces it (two keyframes can't share a position).
 */
export function moveKeyframe(kfs: readonly Keyframe[], id: string, time: number): Keyframe[] {
  const moving = kfs.find((k) => k.id === id);
  if (!moving) return [...kfs];
  const t = Math.max(0, time);
  return kfs
    .filter((k) => k.id === id || Math.abs(k.time - t) >= KEYFRAME_EPS)
    .map((k) => (k.id === id ? { ...k, time: t } : k))
    .sort(byTime);
}

export function updateKeyframe(kfs: readonly Keyframe[], id: string, patch: Partial<Pick<Keyframe, 'value' | 'easing'>>): Keyframe[] {
  return kfs.map((k) => (k.id === id ? { ...k, ...patch } : k));
}

/** Shifts every keyframe by `delta` seconds (keeps them attached to the content when a clip's start is trimmed). */
export function shiftKeyframes(kfs: readonly Keyframe[], delta: number): Keyframe[] {
  return kfs.map((k) => ({ ...k, time: k.time + delta }));
}

/** Scales keyframe times (a speed change stretches / compresses the clip's content). */
export function scaleKeyframes(kfs: readonly Keyframe[], factor: number): Keyframe[] {
  return kfs.map((k) => ({ ...k, time: k.time * factor }));
}

/**
 * Splits a keyframe list at clip-local time `cut`. Each side gets a boundary
 * keyframe holding the interpolated value at the cut, so the animation of
 * both parts continues exactly as before the split.
 */
export function splitKeyframes(kfs: readonly Keyframe[], cut: number, makeId: () => string): [Keyframe[], Keyframe[]] {
  if (kfs.length === 0) return [[], []];
  const atCut = valueAt(kfs, cut, kfs[0].value);
  const easingAtCut = [...kfs].reverse().find((k) => k.time <= cut)?.easing ?? 'linear';
  const left = kfs.filter((k) => k.time < cut - KEYFRAME_EPS);
  const right = kfs.filter((k) => k.time > cut + KEYFRAME_EPS).map((k) => ({ ...k, id: makeId(), time: k.time - cut }));
  left.push({ id: makeId(), time: cut, value: atCut, easing: easingAtCut });
  right.unshift({ id: makeId(), time: 0, value: atCut, easing: easingAtCut });
  return [left, right];
}
