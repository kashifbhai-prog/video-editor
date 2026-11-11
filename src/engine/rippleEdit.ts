import type { Clip, ProjectDocument, Transition } from '../types';
import { clipEnd, MIN_CLIP_DURATION, quantizeToFrame, splitClipAt } from './timelineModel';

// ---------------------------------------------------------------------------
// Ripple removal of timeline ranges (silence removal, accepted AI cuts).
// Every unlocked track is cut at the same times and everything after a range
// moves left by its length, so picture, separate audio, music and captions
// stay in sync. Pure: returns a new document (one undo step for the caller).
// ---------------------------------------------------------------------------

export interface TimeRange {
  start: number;
  end: number;
}

/** Sorted, merged, frame-aligned ranges at least one frame long. */
export function normalizeRanges(ranges: TimeRange[], fps: number): TimeRange[] {
  const q = ranges
    .map((r) => ({ start: quantizeToFrame(Math.min(r.start, r.end), fps), end: quantizeToFrame(Math.max(r.start, r.end), fps) }))
    .filter((r) => r.end - r.start >= 1 / fps - 1e-9)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of q) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-9) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Cuts [start, end) out of one clip: returns the surviving pieces (0, 1 or 2). */
function cutClip(clip: Clip, r: TimeRange, isStill: boolean, newId: () => string): Clip[] {
  const end = clipEnd(clip);
  if (end <= r.start + 1e-9 || clip.start >= r.end - 1e-9) return [clip];
  const pieces: Clip[] = [];
  // Left piece: [clip.start, r.start)
  // (The part that is cut away may be tiny – only the kept piece must be long enough.)
  if (clip.start < r.start - 1e-9 && r.start - clip.start >= MIN_CLIP_DURATION - 1e-9) {
    pieces.push(splitClipAt(clip, r.start, newId(), isStill)[0]);
  }
  // Right piece: [r.end, end) – keeps the original's tail.
  if (end > r.end + 1e-9 && end - r.end >= MIN_CLIP_DURATION - 1e-9) {
    pieces.push(splitClipAt(clip, r.end, newId(), isStill)[1]);
  }
  return pieces;
}

/**
 * Removes the ranges from every unlocked track and closes the gaps.
 * Returns the new document and how much time was removed.
 */
export function removeTimeRanges(
  doc: ProjectDocument,
  input: TimeRange[],
  isStill: (clip: Clip) => boolean,
  newId: () => string,
): { doc: ProjectDocument; removed: number; lockedTracks: number } {
  const fps = doc.canvas.frameRate;
  const ranges = normalizeRanges(input, fps);
  if (!ranges.length) return { doc, removed: 0, lockedTracks: 0 };
  const locked = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id));
  let clips: Record<string, Clip> = { ...doc.clips };
  let transitions: Record<string, Transition> = { ...(doc.transitions ?? {}) };
  let removed = 0;

  // Last range first, so earlier ranges keep their timeline positions.
  for (const r of [...ranges].reverse()) {
    const len = r.end - r.start;
    const next: Record<string, Clip> = {};
    for (const clip of Object.values(clips)) {
      if (locked.has(clip.trackId)) {
        next[clip.id] = clip;
        continue;
      }
      if (clip.start >= r.end - 1e-9) {
        next[clip.id] = { ...clip, start: quantizeToFrame(clip.start - len, fps) };
        continue;
      }
      const pieces = cutClip(clip, r, isStill(clip), newId);
      if (pieces.length === 1 && pieces[0] === clip) {
        next[clip.id] = clip;
        continue;
      }
      const [first, last] = [pieces[0], pieces[pieces.length - 1]];
      pieces.forEach((p, i) => {
        let piece = p;
        if (piece.start >= r.end - 1e-9) piece = { ...piece, start: quantizeToFrame(piece.start - len, fps) };
        // Audio fades belong to the clip's outer edges, not to the new cut.
        if (piece.audio && pieces.length > 1) {
          piece = { ...piece, audio: { ...piece.audio, fadeIn: i === 0 ? piece.audio.fadeIn : 0, fadeOut: i === pieces.length - 1 ? piece.audio.fadeOut : 0 } };
        }
        next[piece.id] = piece;
      });
      // Re-point transitions at the pieces that now hold the clip's edges.
      const remap: Record<string, Transition> = {};
      for (const tr of Object.values(transitions)) {
        let t2 = tr;
        if (tr.fromClipId === clip.id) t2 = last ? { ...t2, fromClipId: last.id } : t2;
        if (tr.toClipId === clip.id) t2 = first ? { ...t2, toClipId: first.id } : t2;
        remap[tr.id] = t2;
      }
      transitions = remap;
    }
    clips = next;
    removed += len;
  }
  const lockedTracks = doc.tracks.filter((t) => t.locked && Object.values(doc.clips).some((c) => c.trackId === t.id)).length;
  return { doc: { ...doc, clips, transitions }, removed, lockedTracks };
}

/** A copy of `clip` limited to [a, b) (null when less than the minimum length remains). */
export function cropClip(clip: Clip, a: number, b: number, isStill: boolean, newId: () => string): Clip | null {
  const s = Math.max(clip.start, a);
  const e = Math.min(clipEnd(clip), b);
  if (e - s < MIN_CLIP_DURATION - 1e-9) return null;
  let c: Clip = { ...clip, id: newId() };
  if (s > c.start + 1e-9) c = splitClipAt(c, s, newId(), isStill)[1];
  if (e < clipEnd(c) - 1e-9) c = splitClipAt(c, e, newId(), isStill)[0];
  return c;
}

/**
 * Copies timeline ranges (all unlocked tracks together, so picture, audio and
 * captions stay in sync) one after another to the end of the timeline.
 * Returns the new document, the reel's start time and the created clip ids.
 */
export function copyRangesToEnd(
  doc: ProjectDocument,
  ranges: TimeRange[],
  isStill: (clip: Clip) => boolean,
  newId: () => string,
): { doc: ProjectDocument; at: number; ids: string[] } {
  const fps = doc.canvas.frameRate;
  const locked = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id));
  const source = Object.values(doc.clips).filter((c) => !locked.has(c.trackId));
  const end = Object.values(doc.clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const at = quantizeToFrame(end, fps) + (end > 0 ? 1 : 0); // one second of breathing room after the edit
  let insert = at;
  const clips = { ...doc.clips };
  const ids: string[] = [];
  for (const r of normalizeRanges(ranges, fps)) {
    const offset = insert - r.start;
    for (const c of source) {
      if (clipEnd(c) <= r.start + 1e-9 || c.start >= r.end - 1e-9) continue;
      const piece = cropClip(c, r.start, r.end, isStill(c), newId);
      if (!piece) continue;
      const moved = { ...piece, start: quantizeToFrame(piece.start + offset, fps) };
      clips[moved.id] = moved;
      ids.push(moved.id);
    }
    insert += r.end - r.start;
  }
  return { doc: { ...doc, clips }, at, ids };
}
