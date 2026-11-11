import type { Clip, MediaItem, ProjectDocument, TransitionType } from '../types';
import { clipDuration, clipEnd, defaultClipLength } from './timelineModel';

// ---------------------------------------------------------------------------
// A Sequence is the engine's flattened, render-ready view of what to play:
// either the edited timeline or a single library item ("source" preview).
// Building it is pure; the engine never reads stores directly.
// ---------------------------------------------------------------------------

export interface SequenceItem {
  clip: Clip;
  /** Undefined when the source media is missing / not ready, and for text clips. */
  media: MediaItem | undefined;
  /** Higher layers are composited on top. */
  layer: number;
  /** Track visibility (visual clips). */
  visible: boolean;
  /** Track not muted (clips with audio). */
  audible: boolean;
  /** Track volume (0..2). */
  trackVolume: number;
  /** The clip's own timeline range. */
  start: number;
  end: number;
  /**
   * Range in which the clip is rendered / played. Wider than [start, end] when a
   * transition overlaps the neighbouring clip (the clip then shows media beyond
   * its in/out point, or holds its first / last frame when the media has none).
   */
  renderStart: number;
  renderEnd: number;
}

export interface SequenceTransition {
  id: string;
  type: TransitionType;
  fromId: string;
  toId: string;
  /** Effective (clamped) window: [cut - d/2, cut + d/2]. */
  start: number;
  end: number;
}

export interface Sequence {
  /** 'timeline' or 'source:<mediaId>' – a key change resets the engine. */
  key: string;
  items: SequenceItem[];
  transitions: SequenceTransition[];
  duration: number;
  /** Single still image: drawn, but not time-based. */
  still: boolean;
  /** Project frame rate – the playhead rests on this frame grid. */
  fps: number;
  /** The library item when previewing a source. */
  source?: MediaItem;
}

export const EMPTY_SEQUENCE: Sequence = { key: 'timeline', items: [], transitions: [], duration: 0, still: false, fps: 30 };

export function buildTimelineSequence(doc: ProjectDocument, mediaById: Map<string, MediaItem>): Sequence {
  const layerOf = new Map(doc.tracks.map((t, i) => [t.id, doc.tracks.length - i]));
  const trackById = new Map(doc.tracks.map((t) => [t.id, t]));
  const itemsById = new Map<string, SequenceItem>();
  let duration = 0;
  for (const clip of Object.values(doc.clips)) {
    const track = trackById.get(clip.trackId);
    if (!track) continue;
    const media = clip.text ? undefined : mediaById.get(clip.mediaId);
    const end = clipEnd(clip);
    duration = Math.max(duration, end);
    itemsById.set(clip.id, {
      clip,
      media: media?.status === 'ready' ? media : undefined,
      layer: layerOf.get(track.id) ?? 0,
      visible: !track.hidden,
      audible: !track.muted,
      trackVolume: track.volume ?? 1,
      start: clip.start,
      end,
      renderStart: clip.start,
      renderEnd: end,
    });
  }

  const transitions: SequenceTransition[] = [];
  for (const tr of Object.values(doc.transitions ?? {})) {
    const a = itemsById.get(tr.fromClipId);
    const b = itemsById.get(tr.toClipId);
    if (!a || !b) continue;
    // Clamp to what the clips allow today (they may have been trimmed since).
    const d = Math.min(tr.duration, clipDuration(a.clip), clipDuration(b.clip));
    if (d <= 1e-3) continue;
    const cut = b.start;
    const start = cut - d / 2;
    const end = cut + d / 2;
    a.renderEnd = Math.max(a.renderEnd, end);
    b.renderStart = Math.min(b.renderStart, start);
    transitions.push({ id: tr.id, type: tr.type, fromId: a.clip.id, toId: b.clip.id, start, end });
  }

  const items = [...itemsById.values()].sort((a, b) => a.layer - b.layer || a.start - b.start);
  return { key: 'timeline', items, transitions, duration, still: false, fps: doc.canvas.frameRate };
}

export function buildSourceSequence(media: MediaItem, fps: number): Sequence {
  const still = media.kind === 'image';
  const length = still ? 0 : defaultClipLength(media);
  const clip: Clip = {
    id: `source:${media.id}`,
    mediaId: media.id,
    trackId: 'source',
    name: media.name,
    start: 0,
    sourceIn: 0,
    sourceOut: length,
    speed: 1,
    volume: 1,
    opacity: 1,
    transform: { x: 0, y: 0, scale: 1 },
  };
  return {
    key: `source:${media.id}`,
    items:
      media.status === 'ready'
        ? [{ clip, media, layer: 1, visible: true, audible: true, trackVolume: 1, start: 0, end: length, renderStart: 0, renderEnd: length }]
        : [],
    transitions: [],
    duration: length,
    still,
    fps,
    source: media,
  };
}
