import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import { usePlaybackStore } from '../store/playbackStore';
import { previewEngine } from '../engine/previewEngine';
import { ANIMATABLE, animatedValue, clampProp, hasKeyframes } from '../engine/animation';
import {
  DEFAULT_TEXT_DURATION,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSITION_DURATION,
  effectDef,
  NEUTRAL_COLOR,
  type ColorKey,
  type TextPreset,
} from '../engine/catalog';
import { keyframeAt, KEYFRAME_EPS, moveKeyframe, removeKeyframe, updateKeyframe, upsertKeyframe } from '../engine/keyframes';
import { clipDuration, clipEnd, clipsOnTrack, defaultClipLength, isRangeFree, quantizeToFrame } from '../engine/timelineModel';
import { createId } from '../utils/id';
import type {
  AnimatableProperty,
  Clip,
  ClipAnimation,
  ClipEffect,
  EasingType,
  EffectType,
  Keyframe,
  MediaItem,
  TextData,
  TextStyle,
  TransitionType,
} from '../types';
import { getSelectedClipIds, selectClips } from './editingService';

// ---------------------------------------------------------------------------
// Phase 3 editing commands: keyframes, transforms, colour, filters, effects,
// transitions, text, stickers and layer order. Like editingService, every UI
// entry point (panels, preview handles, timeline markers, drag & drop) goes
// through these, and every change is one undoable store commit.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const ui = () => useUiStore.getState();
const notify = (msg: string, tone: 'info' | 'warning' | 'error' | 'success' = 'info') => ui().notify(msg, tone);
const fps = () => project().document.canvas.frameRate;
const playhead = () => usePlaybackStore.getState().timelineTime;
const getClip = (id: string): Clip | undefined => project().document.clips[id];
const kfId = () => createId('kf');

/** Playhead position inside a clip (clip-local seconds, frame-aligned, clamped to the clip). */
export function localPlayhead(clip: Clip): number {
  const t = quantizeToFrame(playhead(), fps()) - clip.start;
  return Math.min(clipDuration(clip), Math.max(0, t));
}

export const isPlayheadInClip = (clip: Clip) => {
  const t = playhead();
  return t >= clip.start - 1e-6 && t <= clipEnd(clip) + 1e-6;
};

// ---- Keyframes ----------------------------------------------------------------------

/**
 * Sets animatable values on a clip. A property that already has keyframes gets
 * a keyframe at the playhead (added or updated); otherwise its static value
 * changes. This is what sliders and the preview handles call.
 */
export function setAnimatedValues(clipId: string, values: Partial<Record<AnimatableProperty, number>>, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip) return;
  const local = localPlayhead(clip);
  let patch: Partial<Clip> = {};
  let working: Clip = clip;
  for (const [prop, raw] of Object.entries(values) as [AnimatableProperty, number][]) {
    const value = clampProp(prop, raw);
    if (hasKeyframes(working, prop)) {
      const keyframes = { ...working.keyframes, [prop]: upsertKeyframe(working.keyframes![prop], local, value, kfId) };
      patch = { ...patch, keyframes };
    } else {
      const p = ANIMATABLE[prop].set(working, value);
      patch = { ...patch, ...p, ...(p.transform ? { transform: { ...working.transform, ...p.transform } } : {}) };
    }
    working = { ...working, ...patch };
  }
  project().updateClip(clipId, patch, coalesceKey);
}

/** Diamond button: adds a keyframe with the current value at the playhead, or removes the one there. */
export function toggleKeyframe(clipId: string, prop: AnimatableProperty) {
  const clip = getClip(clipId);
  if (!clip) return;
  if (!isPlayheadInClip(clip)) {
    notify('Move the playhead over the clip to add a keyframe.', 'info');
    return;
  }
  const local = localPlayhead(clip);
  const list = clip.keyframes?.[prop];
  const existing = keyframeAt(list, local);
  const next = existing ? removeKeyframe(list!, existing.id) : upsertKeyframe(list, local, animatedValue(clip, prop, local), kfId);
  writeKeyframes(clip, prop, next);
}

function writeKeyframes(clip: Clip, prop: AnimatableProperty, list: Keyframe[], coalesceKey?: string) {
  const keyframes = { ...clip.keyframes, [prop]: list };
  // Removing the last keyframe keeps the value it had, as a static value.
  if (list.length === 0) {
    delete keyframes[prop];
    const held = clip.keyframes?.[prop]?.[0]?.value;
    const staticPatch = held !== undefined ? ANIMATABLE[prop].set(clip, held) : {};
    project().updateClip(clip.id, { ...staticPatch, keyframes }, coalesceKey);
    return;
  }
  project().updateClip(clip.id, { keyframes }, coalesceKey);
}

export function deleteKeyframe(clipId: string, prop: AnimatableProperty, id: string) {
  const clip = getClip(clipId);
  const list = clip?.keyframes?.[prop];
  if (!clip || !list) return;
  writeKeyframes(clip, prop, removeKeyframe(list, id));
}

export function clearKeyframes(clipId: string, prop: AnimatableProperty) {
  const clip = getClip(clipId);
  if (!clip?.keyframes?.[prop]?.length) return;
  writeKeyframes(clip, prop, []);
}

export function editKeyframe(clipId: string, prop: AnimatableProperty, id: string, patch: { value?: number; easing?: EasingType }, coalesceKey?: string) {
  const clip = getClip(clipId);
  const list = clip?.keyframes?.[prop];
  if (!clip || !list) return;
  const p = patch.value !== undefined ? { ...patch, value: clampProp(prop, patch.value) } : patch;
  writeKeyframes(clip, prop, updateKeyframe(list, id, p), coalesceKey);
}

/** Moves one keyframe to a new clip-local time (clamped to the clip, frame-aligned). */
export function retimeKeyframe(clipId: string, prop: AnimatableProperty, id: string, local: number) {
  const clip = getClip(clipId);
  const list = clip?.keyframes?.[prop];
  if (!clip || !list) return;
  const t = Math.min(clipDuration(clip), Math.max(0, quantizeToFrame(local, fps())));
  writeKeyframes(clip, prop, moveKeyframe(list, id, t));
}

/** Timeline marker drag: moves every property's keyframe at `from` to `to` (clip-local seconds). */
export function moveKeyframesAt(clipId: string, from: number, to: number) {
  const clip = getClip(clipId);
  if (!clip?.keyframes) return;
  const t = Math.min(clipDuration(clip), Math.max(0, quantizeToFrame(to, fps())));
  if (Math.abs(t - from) < KEYFRAME_EPS) return;
  const keyframes = { ...clip.keyframes };
  for (const prop of Object.keys(keyframes) as AnimatableProperty[]) {
    const k = keyframeAt(keyframes[prop], from);
    if (k) keyframes[prop] = moveKeyframe(keyframes[prop]!, k.id, t);
  }
  project().updateClip(clipId, { keyframes });
}

/** Jumps the playhead to the previous / next keyframe of a clip (any property). */
export function seekToKeyframe(clipId: string, direction: -1 | 1, prop?: AnimatableProperty) {
  const clip = getClip(clipId);
  if (!clip?.keyframes) return;
  const local = playhead() - clip.start;
  const times = (prop ? [clip.keyframes[prop] ?? []] : Object.values(clip.keyframes)).flatMap((l) => (l ?? []).map((k) => k.time));
  const candidates = times.filter((t) => (direction > 0 ? t > local + KEYFRAME_EPS : t < local - KEYFRAME_EPS));
  if (!candidates.length) return;
  const target = direction > 0 ? Math.min(...candidates) : Math.max(...candidates);
  ui().showTimeline();
  previewEngine.seek(clip.start + target);
}

// ---- Transform ------------------------------------------------------------------------

export function fitClip(clipId: string, mode: 'contain' | 'cover') {
  const clip = getClip(clipId);
  if (!clip) return;
  const keyframes = { ...clip.keyframes };
  delete keyframes.x;
  delete keyframes.y;
  delete keyframes.scale;
  project().updateClip(clipId, {
    fit: mode,
    keyframes,
    transform: { ...clip.transform, x: 0, y: 0, scale: 1 },
  });
}

export function resetTransform(clipId: string) {
  const clip = getClip(clipId);
  if (!clip) return;
  const keyframes = { ...clip.keyframes };
  for (const p of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) delete keyframes[p];
  project().updateClip(clipId, {
    opacity: 1,
    fit: 'contain',
    crop: undefined,
    keyframes,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, anchorX: 0.5, anchorY: 0.5 },
  });
}

// ---- Colour & filters -------------------------------------------------------------------

export function setColorValue(clipId: string, key: ColorKey, value: number, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip) return;
  project().updateClip(clipId, { color: { ...NEUTRAL_COLOR, ...clip.color, [key]: value } }, coalesceKey);
}

/** Resets one adjustment, or all of them when `key` is omitted. */
export function resetColor(clipId: string, key?: ColorKey) {
  const clip = getClip(clipId);
  if (!clip?.color) return;
  project().updateClip(clipId, { color: key ? { ...clip.color, [key]: 0 } : { ...NEUTRAL_COLOR } });
}

/** Applies a filter preset to the selected clips (or a given list). */
export function applyFilter(presetId: string | null, ids = visualSelection()) {
  if (!ids.length) {
    notify('Select a video, image or text clip to apply a filter.', 'info');
    return 0;
  }
  return project().updateClips(ids, (c) => ({ filter: presetId ? { presetId, intensity: c.filter?.intensity ?? 1 } : null }));
}

export function setFilterIntensity(clipId: string, intensity: number, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip?.filter) return;
  project().updateClip(clipId, { filter: { ...clip.filter, intensity } }, coalesceKey);
}

// ---- Effects -----------------------------------------------------------------------------

/** Selected clips that can take visual adjustments (not audio). */
export function visualSelection(): string[] {
  const media = useMediaStore.getState().items;
  return getSelectedClipIds().filter((id) => {
    const c = getClip(id);
    return !!c && (c.text || media.find((m) => m.id === c.mediaId)?.kind !== 'audio');
  });
}

export function addEffect(type: EffectType, ids = visualSelection()) {
  if (!ids.length) {
    notify('Select a video, image or text clip to apply an effect.', 'info');
    return 0;
  }
  const n = project().updateClips(ids, (c) => ({
    effects: [...(c.effects ?? []), { id: createId('fx'), type, intensity: effectDef(type).defaultIntensity, enabled: true }],
  }));
  if (n) notify(`${effectDef(type).name} applied to ${n} clip${n === 1 ? '' : 's'}.`, 'success');
  return n;
}

export function updateEffect(clipId: string, effectId: string, patch: Partial<Pick<ClipEffect, 'intensity' | 'enabled'>>, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip?.effects) return;
  project().updateClip(clipId, { effects: clip.effects.map((e) => (e.id === effectId ? { ...e, ...patch } : e)) }, coalesceKey);
}

export function removeEffect(clipId: string, effectId: string) {
  const clip = getClip(clipId);
  if (!clip?.effects) return;
  project().updateClip(clipId, { effects: clip.effects.filter((e) => e.id !== effectId) });
}

export function moveEffect(clipId: string, effectId: string, direction: -1 | 1) {
  const clip = getClip(clipId);
  const list = clip?.effects;
  if (!clip || !list) return;
  const i = list.findIndex((e) => e.id === effectId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  project().updateClip(clipId, { effects: next });
}

// ---- Speed -------------------------------------------------------------------------------

export function setSpeed(clipId: string, speed: number, coalesceKey?: string) {
  project().updateClip(clipId, { speed }, coalesceKey);
}

export function setReversed(clipId: string, reversed: boolean) {
  project().updateClip(clipId, { reversed });
}

// ---- Animation presets ---------------------------------------------------------------------

export function setAnimation(clipId: string, patch: { in?: Partial<ClipAnimation['in']>; out?: Partial<ClipAnimation['out']> }, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip) return;
  const base: ClipAnimation = clip.animation ?? { in: { type: 'none', duration: 0.6 }, out: { type: 'none', duration: 0.6 } };
  project().updateClip(
    clipId,
    { animation: { in: { ...base.in, ...patch.in }, out: { ...base.out, ...patch.out } } },
    coalesceKey,
  );
}

// ---- Transitions ---------------------------------------------------------------------------

/** The clip that starts exactly where `clip` ends on the same track, if any. */
export function nextAdjacent(clip: Clip): Clip | undefined {
  const end = clipEnd(clip);
  return clipsOnTrack(project().document, clip.trackId).find((c) => c.id !== clip.id && Math.abs(c.start - end) < 1e-3);
}
export function prevAdjacent(clip: Clip): Clip | undefined {
  return clipsOnTrack(project().document, clip.trackId).find((c) => c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 1e-3);
}

export function applyTransition(fromClipId: string, toClipId: string, type: TransitionType, duration = DEFAULT_TRANSITION_DURATION) {
  const id = project().addTransition(fromClipId, toClipId, type, duration);
  if (id) ui().setSelection({ kind: 'transition', id });
  return id;
}

/** Library "Apply": the cut after the selected clip (or before it when it is the last one). */
export function applyTransitionToSelection(type: TransitionType) {
  const ids = getSelectedClipIds();
  const clip = ids.length === 1 ? getClip(ids[0]) : undefined;
  if (!clip) {
    notify('Select a clip that touches another clip on its track, or drag the transition onto a cut.', 'info');
    return null;
  }
  const next = nextAdjacent(clip);
  const prev = next ? undefined : prevAdjacent(clip);
  if (!next && !prev) {
    notify('The selected clip has no directly adjacent clip on its track (remove the gap first).', 'warning');
    return null;
  }
  return applyTransition(next ? clip.id : prev!.id, next ? next.id : clip.id, type);
}

/** Finds the cut nearest to `time` on a track (within `tolerance` seconds). */
export function cutNear(trackId: string, time: number, tolerance: number): { from: Clip; to: Clip; at: number } | null {
  const clips = clipsOnTrack(project().document, trackId);
  let best: { from: Clip; to: Clip; at: number } | null = null;
  for (let i = 0; i + 1 < clips.length; i++) {
    const a = clips[i];
    const b = clips[i + 1];
    if (Math.abs(clipEnd(a) - b.start) > 1e-3) continue;
    const d = Math.abs(b.start - time);
    if (d <= tolerance && (!best || d < Math.abs(best.at - time))) best = { from: a, to: b, at: b.start };
  }
  return best;
}

export function removeSelectedTransition() {
  const sel = ui().selection;
  if (sel.kind !== 'transition') return false;
  project().removeTransition(sel.id);
  ui().setSelection({ kind: 'none' });
  return true;
}

// ---- Text ---------------------------------------------------------------------------------

/** Adds a text clip at the playhead on the first text track with room (a new one if needed). */
export function addText(preset?: TextPreset): string | null {
  const doc = project().document;
  const t = quantizeToFrame(playhead(), fps());
  const text: TextData = {
    content: preset?.content ?? 'Your text',
    style: { ...DEFAULT_TEXT_STYLE, ...preset?.style },
  };
  let id: string | null = null;
  project().transaction(() => {
    const fits = (trackId: string) => isRangeFree(clipsOnTrack(project().document, trackId), t, DEFAULT_TEXT_DURATION);
    const track = doc.tracks.find((tr) => tr.type === 'text' && !tr.locked && fits(tr.id));
    const trackId = track?.id ?? project().addTrack('text');
    id = project().addTextClip(trackId, t, text, { y: preset?.y ?? 0 });
  });
  if (id) {
    selectClips([id]);
    // Show the new text right away.
    if (Math.abs(playhead() - t) > 1e-6) previewEngine.seek(t);
  }
  return id;
}

export function updateTextStyle(clipId: string, patch: Partial<TextStyle>, coalesceKey?: string) {
  const clip = getClip(clipId);
  if (!clip?.text) return;
  project().updateClip(clipId, { text: { ...clip.text, style: { ...clip.text.style, ...patch } } }, coalesceKey);
}

export function updateTextContent(clipId: string, content: string) {
  const clip = getClip(clipId);
  if (!clip?.text) return;
  const name = content.split('\n')[0].slice(0, 40) || 'Text';
  // Keep a custom clip name; follow the text while the name is still derived from it.
  const derived = clip.name === (clip.text.content.split('\n')[0].slice(0, 40) || 'Text');
  project().updateClip(clipId, { text: { ...clip.text, content }, ...(derived ? { name } : {}) });
}

// ---- Stickers & overlays ---------------------------------------------------------------------

/** Places an image on an overlay track at the playhead (first overlay track with room, else a new one). */
export function addOverlayAtPlayhead(media: MediaItem): string | null {
  if (media.status !== 'ready' || media.kind === 'audio') return null;
  const t = quantizeToFrame(playhead(), fps());
  const length = defaultClipLength(media);
  let id: string | null = null;
  project().transaction(() => {
    const doc = project().document;
    const fits = (trackId: string) => isRangeFree(clipsOnTrack(doc, trackId), t, length);
    const track = doc.tracks.find((tr) => tr.type === 'overlay' && !tr.locked && fits(tr.id));
    const trackId = track?.id ?? project().addTrack('overlay');
    id = project().addClip(media, trackId, t);
    // Stickers default to a smaller size so they read as overlays.
    if (id && media.kind === 'image') project().updateClip(id, { transform: { x: 0, y: 0, scale: 0.4 } });
  });
  if (id) selectClips([id]);
  return id;
}

/**
 * Layer order: moves a visual clip to the visual track directly above (-1) or
 * below (+1). If that track is busy at the clip's time, a new overlay track is
 * created in between.
 */
export function moveClipLayer(clipId: string, direction: -1 | 1): boolean {
  const clip = getClip(clipId);
  if (!clip || clip.text) return false;
  const doc = project().document;
  const visual = doc.tracks.filter((t) => t.type === 'video' || t.type === 'overlay');
  const i = visual.findIndex((t) => t.id === clip.trackId);
  const target = visual[i + direction];
  const dur = clipDuration(clip);
  if (target && !target.locked && isRangeFree(clipsOnTrack(doc, target.id, new Set([clip.id])), clip.start, dur)) {
    return project().moveClips([{ id: clip.id, start: clip.start, trackId: target.id }]);
  }
  if (direction < 0) {
    // Bring forward into a fresh overlay track on top of the current one.
    let ok = false;
    project().transaction(() => {
      const trackId = project().addTrack('overlay');
      ok = project().moveClips([{ id: clip.id, start: clip.start, trackId }]);
    });
    return ok;
  }
  notify('There is no free visual track below this clip.', 'info');
  return false;
}
