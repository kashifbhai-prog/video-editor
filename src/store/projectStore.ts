import { create } from 'zustand';
import type {
  AspectRatio,
  CanvasSettings,
  Clip,
  FrameRate,
  MediaItem,
  ProjectDocument,
  ResolutionPreset,
  Track,
  TextData,
  Transition,
  TransitionType,
  TrackType,
} from '../types';
import { createId } from '../utils/id';
import {
  clipDuration,
  clipEnd,
  clipsOnTrack,
  defaultClipLength,
  isRangeFree,
  MIN_CLIP_DURATION,
  resolvePlacement,
  retimeKeyframesForTrim,
  sourceLimit,
  splitClip,
  trackAccepts,
} from '../engine/timelineModel';
import { scaleKeyframes } from '../engine/keyframes';
import { DEFAULT_TEXT_DURATION, MAX_TRANSITION_DURATION, MIN_TRANSITION_DURATION } from '../engine/catalog';

// ---------------------------------------------------------------------------
// Project store: the undoable project document (name, canvas, tracks, clips)
// plus a snapshot history. Every mutation goes through `commit`.
//
// Memory: snapshots share structure – an edit copies the clips map (pointers
// only) and the edited clips; untouched clips/tracks are shared between
// snapshots. Media binaries are never part of the document.
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 600;

/** Transaction state: while > 0, commits update the document without new history entries. */
let batchDepth = 0;
let batchBase: ProjectDocument | null = null;

export const TRACK_TYPE_ORDER: Record<TrackType, number> = {
  text: 0,
  overlay: 1,
  video: 2,
  audio: 3,
};

export const TRACK_TYPE_LABEL: Record<TrackType, string> = {
  video: 'Video',
  overlay: 'Overlay',
  text: 'Text',
  audio: 'Audio',
};

export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1 } as const;

function makeTrack(type: TrackType, name: string, isMain = false): Track {
  return { id: createId('trk'), type, name, isMain, locked: false, hidden: false, muted: false };
}

export function createDefaultDocument(): ProjectDocument {
  return {
    name: 'Untitled Project',
    canvas: { aspectRatio: '16:9', resolution: '1080p', backgroundColor: '#000000', frameRate: 30 },
    tracks: [
      makeTrack('text', 'Text 1'),
      makeTrack('overlay', 'Overlay 1'),
      makeTrack('video', 'Main Video', true),
      makeTrack('audio', 'Audio 1'),
    ],
    clips: {},
  };
}

/** Groups tracks by type (stable within a group). */
function sortTracks(tracks: Track[]): Track[] {
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => TRACK_TYPE_ORDER[a.t.type] - TRACK_TYPE_ORDER[b.t.type] || a.i - b.i)
    .map(({ t }) => t);
}

function nextTrackName(tracks: Track[], type: TrackType): string {
  const base = TRACK_TYPE_LABEL[type];
  let max = 0;
  for (const t of tracks) {
    const m = t.name.match(new RegExp(`^${base} (\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`;
}

/** Upgrades documents saved by older versions (Phase 1 had `track.clips` arrays and no clip map). */
export function migrateDocument(raw: ProjectDocument): ProjectDocument {
  const legacyTracks = raw.tracks as (Track & { clips?: unknown })[];
  const tracks = legacyTracks.map(({ clips: _legacy, ...t }) => t);
  const clips: Record<string, Clip> = {};
  for (const c of Object.values(raw.clips ?? {})) {
    if (!tracks.some((t) => t.id === c.trackId)) continue;
    clips[c.id] = {
      ...c,
      name: c.name ?? 'Clip',
      speed: c.speed > 0 ? c.speed : 1,
      volume: c.volume ?? 1,
      opacity: c.opacity ?? 1,
      mediaId: c.mediaId ?? '',
      transform: { ...DEFAULT_TRANSFORM, ...c.transform },
    };
  }
  return pruneTransitions({ ...raw, tracks: sortTracks(tracks), clips, transitions: { ...(raw.transitions ?? {}) } });
}

/** Two clips meet when the first ends exactly where the second starts (frame-grid tolerance). */
const ADJACENT_EPS = 1e-3;

/** Why a transition can't be placed between two clips, or null when it can. */
export function transitionBlocker(doc: ProjectDocument, fromId: string, toId: string): string | null {
  const a = doc.clips[fromId];
  const b = doc.clips[toId];
  if (!a || !b) return 'Both clips must exist.';
  if (a.trackId !== b.trackId) return 'Transitions join two clips on the same track.';
  const track = trackOf(doc, a.trackId);
  if (!track || track.type === 'audio') return 'Transitions apply to visual tracks.';
  if (track.locked) return `"${track.name}" is locked.`;
  if (Math.abs(clipEnd(a) - b.start) > ADJACENT_EPS) return 'The clips must touch (no gap between them).';
  return null;
}

/** Longest transition the two clips allow (each side may use at most its whole clip). */
export const maxTransitionDuration = (doc: ProjectDocument, fromId: string, toId: string) => {
  const a = doc.clips[fromId];
  const b = doc.clips[toId];
  if (!a || !b) return MIN_TRANSITION_DURATION;
  return Math.max(MIN_TRANSITION_DURATION, Math.min(MAX_TRANSITION_DURATION, clipDuration(a), clipDuration(b)));
};

/**
 * Drops transitions whose clips were deleted, moved apart or onto different
 * tracks. Runs on every commit, so the document never holds a dangling one.
 */
export function pruneTransitions(doc: ProjectDocument): ProjectDocument {
  const all = doc.transitions;
  if (!all) return doc;
  let changed = false;
  const next: Record<string, Transition> = {};
  for (const tr of Object.values(all)) {
    const a = doc.clips[tr.fromClipId];
    const b = doc.clips[tr.toClipId];
    if (!a || !b || a.trackId !== b.trackId || Math.abs(clipEnd(a) - b.start) > ADJACENT_EPS) {
      changed = true;
      continue;
    }
    next[tr.id] = tr;
  }
  return changed ? { ...doc, transitions: next } : doc;
}

type TrackFlag = 'locked' | 'hidden' | 'muted';
export type ClipPropertyPatch = Partial<
  Pick<
    Clip,
    | 'name'
    | 'volume'
    | 'opacity'
    | 'transform'
    | 'speed'
    | 'reversed'
    | 'fit'
    | 'crop'
    | 'keyframes'
    | 'color'
    | 'filter'
    | 'effects'
    | 'animation'
    | 'text'
    | 'audio'
  >
>;
export interface ClipMove {
  id: string;
  start: number;
  trackId: string;
}

interface ProjectState {
  projectId: string;
  createdAt: number;
  savedAt: number | null;
  dirty: boolean;
  document: ProjectDocument;
  past: ProjectDocument[];
  future: ProjectDocument[];
  lastCommit: { key: string; at: number } | null;

  /** Apply an undoable change. Calls sharing `coalesceKey` in quick succession merge into one step. */
  commit: (updater: (doc: ProjectDocument) => ProjectDocument, coalesceKey?: string) => void;
  /** Runs several commits as ONE undo step (e.g. create a track and place a clip on it). */
  transaction: (fn: () => void) => void;
  undo: () => void;
  redo: () => void;

  setName: (name: string) => void;
  setAspectRatio: (aspect: AspectRatio) => void;
  setResolution: (resolution: ResolutionPreset) => void;
  setBackgroundColor: (color: string) => void;
  setFrameRate: (fps: FrameRate) => void;

  addTrack: (type: TrackType) => string;
  removeTrack: (id: string) => void;
  renameTrack: (id: string, name: string) => void;
  toggleTrackFlag: (id: string, flag: TrackFlag) => void;
  /** Track volume 0..2 (1 = unity). */
  setTrackVolume: (id: string, volume: number, coalesceKey?: string) => void;

  /** Adds a clip for `media` at `start` (moved to the nearest free slot). Returns the clip id or null. */
  addClip: (media: MediaItem, trackId: string, start: number) => string | null;
  /** Moves clips; returns false (and changes nothing) if the result would overlap or is invalid. */
  moveClips: (moves: ClipMove[]) => boolean;
  /** Applies a trim result (start / sourceIn / sourceOut) to a clip. */
  setClipTiming: (id: string, timing: Pick<Clip, 'start' | 'sourceIn' | 'sourceOut'>) => void;
  updateClip: (id: string, patch: ClipPropertyPatch, coalesceKey?: string) => void;
  /** Applies a patch computed per clip to several clips as one undo step. Returns how many changed. */
  updateClips: (ids: string[], patchFor: (clip: Clip) => ClipPropertyPatch | null, coalesceKey?: string) => number;
  /** Adds a text clip; returns its id or null (locked / not a text track). */
  addTextClip: (trackId: string, start: number, text: TextData, transform?: Partial<Clip['transform']>, duration?: number) => string | null;
  /** Adds (or replaces) the transition on the cut between two adjacent clips. */
  addTransition: (fromClipId: string, toClipId: string, type: TransitionType, duration: number) => string | null;
  updateTransition: (id: string, patch: Partial<Pick<Transition, 'type' | 'duration'>>, coalesceKey?: string) => void;
  removeTransition: (id: string) => void;
  /** Moves a track up (-1) or down (+1) within its group (changes layer order). */
  moveTrack: (id: string, direction: -1 | 1) => boolean;
  /** Splits clips at timeline time `t`; returns the ids of the new right-hand parts. */
  splitClips: (ids: string[], t: number, isStill: (mediaId: string) => boolean) => string[];
  deleteClips: (ids: string[]) => number;
  /** Inserts copies of clips (new ids), each at its `start` or the nearest free slot. Returns new ids. */
  insertClipCopies: (clips: Clip[]) => string[];
  removeClipsForMedia: (mediaId: string) => void;

  loadProject: (p: { id: string; createdAt: number; savedAt: number; document: ProjectDocument }) => void;
  resetProject: () => void;
  markSaved: (at: number) => void;
  markDirty: () => void;
}

const updateCanvas =
  (patch: Partial<CanvasSettings>) =>
  (doc: ProjectDocument): ProjectDocument => ({ ...doc, canvas: { ...doc.canvas, ...patch } });

const trackOf = (doc: ProjectDocument, id: string) => doc.tracks.find((t) => t.id === id);
export const trackFamily = (t: TrackType) => (t === 'audio' ? 'audio' : t === 'text' ? 'text' : 'visual');
const isEditable = (doc: ProjectDocument, clip: Clip | undefined): clip is Clip =>
  !!clip && !trackOf(doc, clip.trackId)?.locked;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Merges a property patch into a clip, clamping every value to its valid range. */
function applyClipPatch(d: ProjectDocument, clip: Clip, patch: ClipPropertyPatch): Clip {
  const next: Clip = { ...clip, ...patch, transform: { ...clip.transform, ...patch.transform } };
  next.volume = clamp(next.volume, 0, 1);
  next.opacity = clamp(next.opacity, 0, 1);
  next.transform.scale = clamp(next.transform.scale, 0.05, 5);
  next.transform.x = clamp(next.transform.x, -3, 3);
  next.transform.y = clamp(next.transform.y, -3, 3);
  if (next.transform.rotation !== undefined) next.transform.rotation = clamp(next.transform.rotation, -3600, 3600);
  if (next.transform.anchorX !== undefined) next.transform.anchorX = clamp(next.transform.anchorX, 0, 1);
  if (next.transform.anchorY !== undefined) next.transform.anchorY = clamp(next.transform.anchorY, 0, 1);
  if (next.crop) {
    const c = { ...next.crop };
    for (const k of ['left', 'top', 'right', 'bottom'] as const) c[k] = clamp(c[k], 0, 0.95);
    // At least 5 % of the frame stays visible in each direction.
    if (c.left + c.right > 0.95) c.right = 0.95 - c.left;
    if (c.top + c.bottom > 0.95) c.bottom = 0.95 - c.top;
    next.crop = c;
  }
  if (next.effects) next.effects = next.effects.map((e) => ({ ...e, intensity: clamp(e.intensity, 0, 1) }));
  if (next.filter) next.filter = { ...next.filter, intensity: clamp(next.filter.intensity, 0, 1) };
  if (next.audio) {
    const a = next.audio;
    next.audio = {
      gainDb: clamp(a.gainDb, -24, 24),
      fadeIn: clamp(a.fadeIn, 0, 60),
      fadeOut: clamp(a.fadeOut, 0, 60),
      bass: clamp(a.bass, -15, 15),
      treble: clamp(a.treble, -15, 15),
      eq: a.eq.map((v) => clamp(v, -12, 12)) as typeof a.eq,
      pan: clamp(a.pan, -1, 1),
      noiseReduction: clamp(a.noiseReduction, 0, 1),
    };
  }
  if (clip.text) {
    next.speed = 1;
    next.reversed = false;
  } else if (patch.speed !== undefined && patch.speed !== clip.speed) {
    next.speed = clamp(patch.speed, 0.25, 4);
    // Keyframes follow the content: at 2x the same moment arrives twice as early.
    if (next.keyframes) {
      const factor = clip.speed / next.speed;
      const scaled: NonNullable<Clip['keyframes']> = {};
      for (const [prop, list] of Object.entries(next.keyframes)) if (list) scaled[prop as keyof typeof scaled] = scaleKeyframes(list, factor);
      next.keyframes = scaled;
    }
    // Changing speed changes the clip length; keep it clear of the next clip.
    const nextStart = clipsOnTrack(d, clip.trackId)
      .filter((c) => c.id !== clip.id && c.start >= clipEnd(clip) - 1e-6)
      .reduce((m, c) => Math.min(m, c.start), Infinity);
    const maxDur = nextStart - clip.start;
    if (clipDuration(next) > maxDur) {
      if (next.reversed) next.sourceIn = next.sourceOut - maxDur * next.speed;
      else next.sourceOut = next.sourceIn + maxDur * next.speed;
    }
  }
  return next;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projectId: createId('prj'),
  createdAt: Date.now(),
  savedAt: null,
  dirty: false,
  document: createDefaultDocument(),
  past: [],
  future: [],
  lastCommit: null,

  commit: (updater, coalesceKey) => {
    const { document, past, lastCommit } = get();
    const next = pruneTransitions(updater(document));
    if (next === document || JSON.stringify(next) === JSON.stringify(document)) return;
    if (batchDepth > 0) {
      // Inside a transaction: history is recorded once when it ends.
      set({ document: next, dirty: true });
      return;
    }
    const now = Date.now();
    const coalesce =
      coalesceKey !== undefined &&
      lastCommit?.key === coalesceKey &&
      now - lastCommit.at < COALESCE_WINDOW_MS &&
      past.length > 0;
    set({
      document: next,
      past: coalesce ? past : [...past, document].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  },

  transaction: (fn) => {
    if (batchDepth === 0) batchBase = get().document;
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        const base = batchBase!;
        batchBase = null;
        if (get().document !== base) {
          set((s) => ({ past: [...s.past, base].slice(-HISTORY_LIMIT), future: [], lastCommit: null }));
        }
      }
    }
  },

  undo: () => {
    const { past, future, document } = get();
    if (!past.length) return;
    set({
      document: past[past.length - 1],
      past: past.slice(0, -1),
      future: [document, ...future],
      dirty: true,
      lastCommit: null,
    });
  },

  redo: () => {
    const { past, future, document } = get();
    if (!future.length) return;
    set({
      document: future[0],
      past: [...past, document],
      future: future.slice(1),
      dirty: true,
      lastCommit: null,
    });
  },

  setName: (name) => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    get().commit((d) => ({ ...d, name: trimmed }));
  },
  setAspectRatio: (aspectRatio) => get().commit(updateCanvas({ aspectRatio })),
  setResolution: (resolution) => get().commit(updateCanvas({ resolution })),
  setBackgroundColor: (backgroundColor) =>
    get().commit(updateCanvas({ backgroundColor }), 'canvas.backgroundColor'),
  setFrameRate: (frameRate) => get().commit(updateCanvas({ frameRate })),

  // ---- Tracks -------------------------------------------------------------
  addTrack: (type) => {
    const track = makeTrack(type, nextTrackName(get().document.tracks, type));
    // New tracks go to the top of their group (rendered above existing ones).
    get().commit((d) => ({ ...d, tracks: sortTracks([track, ...d.tracks]) }));
    return track.id;
  },
  removeTrack: (id) =>
    get().commit((d) => {
      const track = trackOf(d, id);
      if (!track || track.isMain) return d;
      const clips = { ...d.clips };
      for (const c of Object.values(clips)) if (c.trackId === id) delete clips[c.id];
      return { ...d, tracks: d.tracks.filter((t) => t.id !== id), clips };
    }),
  renameTrack: (id, name) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    get().commit((d) => ({
      ...d,
      tracks: d.tracks.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    }));
  },
  setTrackVolume: (id, volume, coalesceKey) =>
    get().commit(
      (d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, volume: clamp(volume, 0, 2) } : t)) }),
      coalesceKey,
    ),
  toggleTrackFlag: (id, flag) =>
    get().commit((d) => ({
      ...d,
      tracks: d.tracks.map((t) => (t.id === id ? { ...t, [flag]: !t[flag] } : t)),
    })),

  // ---- Clips --------------------------------------------------------------
  addClip: (media, trackId, start) => {
    const doc = get().document;
    const track = trackOf(doc, trackId);
    if (!track || track.locked || !trackAccepts(track.type, media.kind) || media.status !== 'ready') return null;
    const length = defaultClipLength(media);
    const clip: Clip = {
      id: createId('clp'),
      mediaId: media.id,
      trackId,
      name: media.name,
      start: resolvePlacement(clipsOnTrack(doc, trackId), start, length),
      sourceIn: 0,
      sourceOut: length,
      speed: 1,
      volume: 1,
      opacity: 1,
      transform: { ...DEFAULT_TRANSFORM },
    };
    get().commit((d) => ({ ...d, clips: { ...d.clips, [clip.id]: clip } }));
    return clip.id;
  },

  moveClips: (moves) => {
    const doc = get().document;
    const next = { ...doc.clips };
    for (const m of moves) {
      const clip = doc.clips[m.id];
      const target = trackOf(doc, m.trackId);
      const source = clip && trackOf(doc, clip.trackId);
      if (!isEditable(doc, clip) || !source || !target || target.locked || m.start < -1e-6) return false;
      // Visual clips move between video/overlay tracks; audio stays on audio tracks.
      if (trackFamily(target.type) !== trackFamily(source.type)) return false;
      next[m.id] = { ...clip, start: Math.max(0, m.start), trackId: m.trackId };
    }
    // Validate: no moved clip may overlap anything on its target track.
    for (const m of moves) {
      const c = next[m.id];
      const others = clipsOnTrack({ clips: next }, c.trackId).filter((o) => o.id !== c.id);
      if (!isRangeFree(others, c.start, clipDuration(c))) return false;
    }
    get().commit((d) => ({ ...d, clips: next }));
    return true;
  },

  setClipTiming: (id, timing) =>
    get().commit((d) => {
      const clip = d.clips[id];
      if (!isEditable(d, clip)) return d;
      if (timing.sourceOut - timing.sourceIn < MIN_CLIP_DURATION * clip.speed - 1e-9 || timing.sourceIn < -1e-9) return d;
      // Keyframes stay attached to the content when the start edge moves.
      const keyframes = retimeKeyframesForTrim(clip, timing.start);
      return { ...d, clips: { ...d.clips, [id]: { ...clip, ...timing, ...(keyframes ? { keyframes } : {}) } } };
    }),

  updateClip: (id, patch, coalesceKey) =>
    get().commit((d) => {
      const clip = d.clips[id];
      if (!isEditable(d, clip)) return d;
      return { ...d, clips: { ...d.clips, [id]: applyClipPatch(d, clip, patch) } };
    }, coalesceKey),

  updateClips: (ids, patchFor, coalesceKey) => {
    let changed = 0;
    get().commit((d) => {
      changed = 0;
      const clips = { ...d.clips };
      for (const id of ids) {
        const clip = d.clips[id];
        if (!isEditable(d, clip)) continue;
        const patch = patchFor(clip);
        if (!patch) continue;
        clips[id] = applyClipPatch(d, clip, patch);
        changed++;
      }
      return changed ? { ...d, clips } : d;
    }, coalesceKey);
    return changed;
  },

  addTextClip: (trackId, start, text, transform, duration = DEFAULT_TEXT_DURATION) => {
    const doc = get().document;
    const track = trackOf(doc, trackId);
    if (!track || track.locked || track.type !== 'text') return null;
    const clip: Clip = {
      id: createId('clp'),
      mediaId: '',
      trackId,
      name: text.content.split('\n')[0].slice(0, 40) || 'Text',
      start: resolvePlacement(clipsOnTrack(doc, trackId), start, duration),
      sourceIn: 0,
      sourceOut: duration,
      speed: 1,
      volume: 1,
      opacity: 1,
      transform: { ...DEFAULT_TRANSFORM, ...transform },
      text,
    };
    get().commit((d) => ({ ...d, clips: { ...d.clips, [clip.id]: clip } }));
    return clip.id;
  },

  addTransition: (fromClipId, toClipId, type, duration) => {
    const doc = get().document;
    if (transitionBlocker(doc, fromClipId, toClipId)) return null;
    const existing = Object.values(doc.transitions ?? {}).find((t) => t.fromClipId === fromClipId && t.toClipId === toClipId);
    const id = existing?.id ?? createId('trn');
    const max = maxTransitionDuration(doc, fromClipId, toClipId);
    const tr: Transition = { id, type, fromClipId, toClipId, duration: Math.min(max, Math.max(MIN_TRANSITION_DURATION, duration)) };
    get().commit((d) => ({ ...d, transitions: { ...d.transitions, [id]: tr } }));
    return id;
  },

  updateTransition: (id, patch, coalesceKey) =>
    get().commit((d) => {
      const tr = d.transitions?.[id];
      if (!tr) return d;
      const next = { ...tr, ...patch };
      const max = maxTransitionDuration(d, tr.fromClipId, tr.toClipId);
      next.duration = Math.min(max, Math.max(MIN_TRANSITION_DURATION, next.duration));
      return { ...d, transitions: { ...d.transitions, [id]: next } };
    }, coalesceKey),

  removeTransition: (id) =>
    get().commit((d) => {
      if (!d.transitions?.[id]) return d;
      const transitions = { ...d.transitions };
      delete transitions[id];
      return { ...d, transitions };
    }),

  moveTrack: (id, direction) => {
    const tracks = get().document.tracks;
    const i = tracks.findIndex((t) => t.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= tracks.length || tracks[j].type !== tracks[i].type) return false;
    get().commit((d) => {
      const next = [...d.tracks];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, tracks: next };
    });
    return true;
  },

  splitClips: (ids, t, isStill) => {
    const created: string[] = [];
    get().commit((d) => {
      const clips = { ...d.clips };
      for (const id of ids) {
        const clip = d.clips[id];
        if (!isEditable(d, clip)) continue;
        const parts = splitClip(clip, t, createId('clp'), !!clip.text || isStill(clip.mediaId));
        if (!parts) continue;
        clips[parts[0].id] = parts[0];
        clips[parts[1].id] = parts[1];
        created.push(parts[1].id);
      }
      return created.length ? { ...d, clips } : d;
    });
    return created;
  },

  deleteClips: (ids) => {
    let removed = 0;
    get().commit((d) => {
      const clips = { ...d.clips };
      for (const id of ids) {
        if (isEditable(d, clips[id])) {
          delete clips[id];
          removed++;
        }
      }
      return removed ? { ...d, clips } : d;
    });
    return removed;
  },

  insertClipCopies: (sources) => {
    const created: string[] = [];
    get().commit((d) => {
      const clips = { ...d.clips };
      // Earliest first so copies keep their relative order.
      for (const src of [...sources].sort((a, b) => a.start - b.start)) {
        const track = trackOf(d, src.trackId);
        if (!track || track.locked) continue;
        const copy: Clip = { ...src, id: createId('clp'), transform: { ...src.transform } };
        copy.start = resolvePlacement(clipsOnTrack({ clips }, copy.trackId), copy.start, clipDuration(copy));
        clips[copy.id] = copy;
        created.push(copy.id);
      }
      return created.length ? { ...d, clips } : d;
    });
    return created;
  },

  removeClipsForMedia: (mediaId) =>
    get().commit((d) => {
      const entries = Object.entries(d.clips).filter(([, c]) => c.mediaId !== mediaId);
      return entries.length === Object.keys(d.clips).length ? d : { ...d, clips: Object.fromEntries(entries) };
    }),

  // ---- Lifecycle ----------------------------------------------------------
  loadProject: ({ id, createdAt, savedAt, document }) =>
    set({
      projectId: id,
      createdAt,
      savedAt,
      document: migrateDocument(document),
      past: [],
      future: [],
      dirty: false,
      lastCommit: null,
    }),
  resetProject: () =>
    set({
      projectId: createId('prj'),
      createdAt: Date.now(),
      savedAt: null,
      document: createDefaultDocument(),
      past: [],
      future: [],
      dirty: false,
      lastCommit: null,
    }),
  markSaved: (at) => set({ savedAt: at, dirty: false }),
  markDirty: () => set({ dirty: true }),
}));

/** Selector helpers */
export const selectCanUndo = (s: ProjectState) => s.past.length > 0;
export const selectCanRedo = (s: ProjectState) => s.future.length > 0;

/** Clamp helper for UIs that edit a clip's source range directly. */
export const maxSourceOut = (media: MediaItem | undefined) => sourceLimit(media);
