import type { AnimatableProperty, Clip, MediaItem, MediaKind, ProjectDocument, TrackType } from '../types';
import { createId } from '../utils/id';
import { shiftKeyframes, splitKeyframes } from './keyframes';

// ---------------------------------------------------------------------------
// Pure timeline model: timing math, placement, trimming and splitting.
// No React / store dependencies, so the same rules can drive the UI, the
// playback engine and (Phase 4) the export renderer.
// ---------------------------------------------------------------------------

/** Shortest clip the editor allows, in timeline seconds. */
export const MIN_CLIP_DURATION = 0.1;
/** Default length of an image clip, in seconds. */
export const DEFAULT_IMAGE_DURATION = 5;
const EPS = 1e-6;

/**
 * Rounds a timeline time to the nearest frame boundary. Edit points (cuts,
 * trims, moves, the paused playhead) live on the frame grid, so adjacent clips
 * can't be left with sub-frame gaps that flash the background during playback.
 */
export const quantizeToFrame = (t: number, fps: number) => Math.max(0, Math.round(t * fps) / fps);

export const clipDuration = (c: Pick<Clip, 'sourceIn' | 'sourceOut' | 'speed'>) => (c.sourceOut - c.sourceIn) / c.speed;
export const clipEnd = (c: Clip) => c.start + clipDuration(c);

/** Media kinds each track type accepts. */
const TRACK_ACCEPTS: Record<TrackType, MediaKind[]> = {
  video: ['video', 'image'],
  overlay: ['video', 'image'],
  audio: ['audio'],
  text: [],
};

export const trackAccepts = (trackType: TrackType, kind: MediaKind) => TRACK_ACCEPTS[trackType].includes(kind);

/** Text clips have no media; they live on text tracks only. */
export const isTextClip = (c: Pick<Clip, 'text'>) => !!c.text;

/** Stills (images, text) have no time-based source: their range is just a display length. */
export const isStillClip = (c: Pick<Clip, 'text'>, media: Pick<MediaItem, 'kind'> | undefined) => !!c.text || media?.kind === 'image';

/** Track type to create when media is dropped on "new track". */
export const newTrackTypeFor = (kind: MediaKind): 'overlay' | 'audio' => (kind === 'audio' ? 'audio' : 'overlay');

/** Longest source range the media allows (Infinity for stills). */
export function sourceLimit(media: Pick<MediaItem, 'kind' | 'duration'> | undefined): number {
  if (!media || media.kind === 'image') return Infinity;
  return media.duration ?? Infinity;
}

/** Natural clip length for a media item. */
export function defaultClipLength(media: Pick<MediaItem, 'kind' | 'duration'>): number {
  if (media.kind === 'image') return DEFAULT_IMAGE_DURATION;
  return media.duration && media.duration > 0 ? media.duration : DEFAULT_IMAGE_DURATION;
}

/** Clips on a track ordered by start, optionally excluding some ids. */
export function clipsOnTrack(doc: Pick<ProjectDocument, 'clips'>, trackId: string, exclude?: ReadonlySet<string>): Clip[] {
  return Object.values(doc.clips)
    .filter((c) => c.trackId === trackId && !exclude?.has(c.id))
    .sort((a, b) => a.start - b.start);
}

export const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd - EPS && bStart < aEnd - EPS;

export function isRangeFree(clips: Clip[], start: number, duration: number): boolean {
  const end = start + duration;
  return start >= -EPS && clips.every((c) => !rangesOverlap(start, end, c.start, clipEnd(c)));
}

/**
 * Overlap policy: clips on one track never overlap. If the desired position is
 * occupied, the clip is placed in the nearest free gap (before or after the
 * blocking clips) – non-destructive and predictable.
 */
export function resolvePlacement(clips: Clip[], desiredStart: number, duration: number): number {
  const desired = Math.max(0, desiredStart);
  if (isRangeFree(clips, desired, duration)) return desired;
  const candidates = [0];
  for (const c of clips) {
    candidates.push(clipEnd(c));
    candidates.push(c.start - duration);
  }
  let best = Infinity;
  for (const cand of candidates) {
    if (cand < -EPS || !isRangeFree(clips, cand, duration)) continue;
    if (Math.abs(cand - desired) < Math.abs(best - desired)) best = Math.max(0, cand);
  }
  // A slot after the last clip always exists, so `best` is finite.
  return Number.isFinite(best) ? best : Math.max(desired, ...clips.map(clipEnd));
}

/** End of the last clip = length of the edited sequence. */
export function sequenceDuration(doc: Pick<ProjectDocument, 'clips'>): number {
  let end = 0;
  for (const c of Object.values(doc.clips)) end = Math.max(end, clipEnd(c));
  return end;
}

/** Snaps `time` to the closest candidate within `threshold` seconds. */
export function snapTime(time: number, candidates: number[], threshold: number): { time: number; snapped: boolean } {
  let best = time;
  let dist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d <= dist) {
      dist = d;
      best = c;
    }
  }
  return { time: best, snapped: best !== time };
}

type TrimResult = Pick<Clip, 'start' | 'sourceIn' | 'sourceOut'>;

/**
 * Moves the clip's left edge to `newStart` (timeline seconds), keeping the
 * right edge fixed. Clamped to: timeline 0, the previous clip, the start of
 * the source media and the minimum clip length.
 */
export function trimLeft(clip: Clip, newStart: number, media: MediaItem | undefined, neighbours: Clip[]): TrimResult {
  const end = clipEnd(clip);
  const prevEnd = neighbours.filter((c) => c.id !== clip.id && clipEnd(c) <= clip.start + EPS).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const isStill = isStillClip(clip, media);
  // How far left the source allows (stills can extend indefinitely). A reversed
  // clip's left edge shows its source OUT point, so it extends towards the media end.
  const sourceMin = isStill
    ? -Infinity
    : clip.reversed
      ? clip.start - (sourceLimit(media) - clip.sourceOut) / clip.speed
      : clip.start - clip.sourceIn / clip.speed;
  const lo = Math.max(0, prevEnd, sourceMin);
  // A clip already shorter than the minimum may shrink no further, but must not grow.
  const hi = end - Math.min(MIN_CLIP_DURATION, end - clip.start);
  const start = Math.min(hi, Math.max(lo, newStart));
  if (isStill) return { start, sourceIn: 0, sourceOut: (end - start) * clip.speed };
  if (clip.reversed) return { start, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut - (start - clip.start) * clip.speed };
  return { start, sourceIn: clip.sourceIn + (start - clip.start) * clip.speed, sourceOut: clip.sourceOut };
}

/**
 * Moves the clip's right edge to `newEnd`, keeping the left edge fixed.
 * Clamped to: the next clip, the end of the source media and the minimum length.
 */
export function trimRight(clip: Clip, newEnd: number, media: MediaItem | undefined, neighbours: Clip[]): TrimResult {
  const nextStart = neighbours
    .filter((c) => c.id !== clip.id && c.start >= clipEnd(clip) - EPS)
    .reduce((m, c) => Math.min(m, c.start), Infinity);
  const isStill = isStillClip(clip, media);
  // A reversed clip's right edge shows its source IN point: it can extend back to source 0.
  const maxBySource = isStill
    ? Infinity
    : clip.reversed
      ? clip.start + clip.sourceOut / clip.speed
      : clip.start + (sourceLimit(media) - clip.sourceIn) / clip.speed;
  const lo = clip.start + Math.min(MIN_CLIP_DURATION, clipDuration(clip));
  const hi = Math.min(nextStart, maxBySource);
  const end = Math.max(lo, Math.min(hi, newEnd));
  if (clip.reversed && !isStill) return { start: clip.start, sourceIn: clip.sourceOut - (end - clip.start) * clip.speed, sourceOut: clip.sourceOut };
  return { start: clip.start, sourceIn: clip.sourceIn, sourceOut: clip.sourceIn + (end - clip.start) * clip.speed };
}

/**
 * Splits a clip at timeline time `t`. Returns [left, right] or null when `t`
 * is not strictly inside the clip (or would create a too-short part).
 * Both halves keep the same source media and properties.
 */
/**
 * A split must leave both parts at least MIN_CLIP_DURATION long – the same
 * minimum trimming enforces, so every part a split creates stays trimmable.
 */
export const canSplitAt = (clip: Clip, t: number) =>
  t >= clip.start + MIN_CLIP_DURATION - EPS && t <= clipEnd(clip) - MIN_CLIP_DURATION + EPS;

export function splitClip(clip: Clip, t: number, newId: string, isStill: boolean): [Clip, Clip] | null {
  const end = clipEnd(clip);
  if (!canSplitAt(clip, t)) return null;
  let left: Clip;
  let right: Clip;
  if (isStill) {
    left = { ...clip, sourceIn: 0, sourceOut: (t - clip.start) * clip.speed };
    right = { ...clip, id: newId, start: t, sourceIn: 0, sourceOut: (end - t) * clip.speed };
  } else if (clip.reversed) {
    // Reversed: the left part plays sourceOut → cut, the right part cut → sourceIn.
    const cut = clip.sourceOut - (t - clip.start) * clip.speed;
    left = { ...clip, sourceIn: cut };
    right = { ...clip, id: newId, start: t, sourceOut: cut };
  } else {
    const cut = clip.sourceIn + (t - clip.start) * clip.speed;
    left = { ...clip, sourceOut: cut };
    right = { ...clip, id: newId, start: t, sourceIn: cut };
  }
  // Keyframes: each part keeps its own, with a boundary key so animation is continuous across the cut.
  if (clip.keyframes) {
    const lk: NonNullable<Clip['keyframes']> = {};
    const rk: NonNullable<Clip['keyframes']> = {};
    for (const prop of Object.keys(clip.keyframes) as AnimatableProperty[]) {
      const list = clip.keyframes[prop];
      if (!list?.length) continue;
      const [l, r] = splitKeyframes(list, t - clip.start, () => createId('kf'));
      lk[prop] = l;
      rk[prop] = r;
    }
    left.keyframes = lk;
    right.keyframes = rk;
  }
  // Entrance animation stays on the left part, exit animation moves to the right part.
  if (clip.animation) {
    left.animation = { ...clip.animation, out: { ...clip.animation.out, type: 'none' } };
    right.animation = { ...clip.animation, in: { ...clip.animation.in, type: 'none' } };
  }
  return [left, right];
}

/** Keeps keyframes attached to the content when a trim moves the clip's start. */
export function retimeKeyframesForTrim(clip: Clip, newStart: number): Clip['keyframes'] {
  if (!clip.keyframes || Math.abs(newStart - clip.start) < 1e-9) return clip.keyframes;
  const out: NonNullable<Clip['keyframes']> = {};
  for (const prop of Object.keys(clip.keyframes) as AnimatableProperty[]) {
    const list = clip.keyframes[prop];
    if (list) out[prop] = shiftKeyframes(list, clip.start - newStart);
  }
  return out;
}

/** Source time shown at timeline time `t` for a clip (no bounds check). */
export const sourceTimeAt = (clip: Clip, t: number) =>
  clip.reversed ? clip.sourceOut - (t - clip.start) * clip.speed : clip.sourceIn + (t - clip.start) * clip.speed;

export const isClipActiveAt = (clip: Clip, t: number) => t >= clip.start - EPS && t < clipEnd(clip) - EPS;
