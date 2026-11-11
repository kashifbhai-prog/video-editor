import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import { usePlaybackStore } from '../store/playbackStore';
import { previewEngine } from '../engine/previewEngine';
import { clipEnd, clipsOnTrack, newTrackTypeFor, quantizeToFrame, trackAccepts, trimLeft, trimRight } from '../engine/timelineModel';
import type { Clip, MediaItem } from '../types';

// ---------------------------------------------------------------------------
// Editing commands. Every user-facing edit (toolbar, shortcuts, menus, drag &
// drop) goes through here, so behaviour is identical regardless of entry point.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const ui = () => useUiStore.getState();
const notify = (msg: string, tone: 'info' | 'warning' | 'error' | 'success' = 'info') => ui().notify(msg, tone);

/** Currently selected clip ids that still exist (selection can go stale after undo). */
export function getSelectedClipIds(): string[] {
  const sel = ui().selection;
  if (sel.kind !== 'clips') return [];
  const clips = project().document.clips;
  return sel.ids.filter((id) => clips[id]);
}

export function selectClips(ids: string[]) {
  ui().setSelection({ kind: 'clips', ids });
  ui().showTimeline();
}

/** Click selection: replace, or toggle when `additive` (Ctrl/Shift). */
export function selectClip(id: string, additive: boolean) {
  const current = getSelectedClipIds();
  if (!additive) return selectClips([id]);
  selectClips(current.includes(id) ? current.filter((c) => c !== id) : [...current, id]);
}

export function selectAllClips() {
  selectClips(Object.keys(project().document.clips));
}

function getReadyMedia(mediaId: string): MediaItem | undefined {
  const media = useMediaStore.getState().items.find((m) => m.id === mediaId);
  if (!media || media.status !== 'ready') {
    notify('This media is not ready yet.', 'warning');
    return undefined;
  }
  return media;
}

function afterInsert(clipId: string | null) {
  if (!clipId) return;
  selectClips([clipId]);
}

/**
 * "+" on a library item: visuals are appended to the end of the main track;
 * audio goes to the playhead on the first audio track with room (a new audio
 * track is created if needed).
 */
export function addMediaToTimeline(mediaId: string): string | null {
  const media = getReadyMedia(mediaId);
  if (!media) return null;
  const doc = project().document;
  if (media.kind === 'audio') {
    const t = usePlaybackStore.getState().timelineTime;
    let id: string | null = null;
    // Creating a track + placing the clip is one undo step.
    project().transaction(() => {
      const trackId = doc.tracks.find((tr) => tr.type === 'audio' && !tr.locked)?.id ?? project().addTrack('audio');
      id = project().addClip(media, trackId, t);
    });
    afterInsert(id);
    return id;
  }
  const main = doc.tracks.find((t) => t.isMain);
  if (!main || main.locked) {
    notify('The main track is locked. Unlock it or drag the media onto another track.', 'warning');
    return null;
  }
  const end = clipsOnTrack(doc, main.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const id = project().addClip(media, main.id, end);
  afterInsert(id);
  return id;
}

/** Drops media onto a specific track at a timeline time. */
export function dropMediaOnTrack(mediaId: string, trackId: string, time: number): string | null {
  const media = getReadyMedia(mediaId);
  if (!media) return null;
  const track = project().document.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  if (track.locked) {
    notify(`"${track.name}" is locked.`, 'warning');
    return null;
  }
  if (!trackAccepts(track.type, media.kind)) {
    notify(`${media.kind === 'audio' ? 'Audio' : 'Visual'} media can't be placed on a ${track.type} track.`, 'warning');
    return null;
  }
  const id = project().addClip(media, trackId, time);
  afterInsert(id);
  return id;
}

/** Drops media below the existing tracks: creates a fitting track first. */
export function dropMediaOnNewTrack(mediaId: string, time: number): string | null {
  const media = getReadyMedia(mediaId);
  if (!media) return null;
  let id: string | null = null;
  project().transaction(() => {
    const trackId = project().addTrack(newTrackTypeFor(media.kind));
    id = project().addClip(media, trackId, time);
  });
  afterInsert(id);
  return id;
}

const isStill = (mediaId: string) => useMediaStore.getState().items.find((m) => m.id === mediaId)?.kind === 'image';

/** Splits the selected clips at the playhead. */
export function splitSelectedAtPlayhead() {
  const ids = getSelectedClipIds();
  if (!ids.length) {
    notify('Select a clip to split.', 'info');
    return;
  }
  // The playhead is frame-aligned when paused; during playback it is continuous,
  // so round to the nearest frame to keep the cut on the frame grid.
  const t = quantizeToFrame(usePlaybackStore.getState().timelineTime, project().document.canvas.frameRate);
  const doc = project().document;
  if (ids.every((id) => doc.tracks.find((tr) => tr.id === doc.clips[id].trackId)?.locked)) {
    notify('The selected clip is on a locked track.', 'warning');
    return;
  }
  const created = project().splitClips(ids, t, isStill);
  if (!created.length) notify('Move the playhead inside the selected clip to split it.', 'info');
  else selectClips(created);
}

/** Ctrl+X: copy the selected clips, then remove them. */
export function cutSelection() {
  const ids = getSelectedClipIds();
  if (!ids.length) return;
  copySelection();
  const removed = project().deleteClips(ids);
  if (removed < ids.length) notify('Clips on locked tracks were copied but not removed.', 'warning');
  ui().setSelection({ kind: 'none' });
}

/** Selected clips that the playhead is strictly inside (where split / trim-to-playhead apply). */
export function selectedClipsUnderPlayhead(): Clip[] {
  const doc = project().document;
  const t = quantizeToFrame(usePlaybackStore.getState().timelineTime, doc.canvas.frameRate);
  return getSelectedClipIds()
    .map((id) => doc.clips[id])
    .filter((c) => t > c.start + 1e-6 && t < clipEnd(c) - 1e-6);
}

/**
 * Q / W: trims the selected clips' start (or end) to the playhead, with the
 * same rules as dragging the trim handles (neighbours, source limits, minimum length).
 */
export function trimSelectedToPlayhead(side: 'start' | 'end') {
  const clips = selectedClipsUnderPlayhead();
  if (!clips.length) {
    notify('Move the playhead inside the selected clip to trim it.', 'info');
    return;
  }
  const doc = project().document;
  const t = quantizeToFrame(usePlaybackStore.getState().timelineTime, doc.canvas.frameRate);
  const media = useMediaStore.getState().items;
  project().transaction(() => {
    for (const c of clips) {
      if (doc.tracks.find((tr) => tr.id === c.trackId)?.locked) continue;
      const m = media.find((x) => x.id === c.mediaId);
      const neighbours = clipsOnTrack(project().document, c.trackId);
      project().setClipTiming(c.id, side === 'start' ? trimLeft(c, t, m, neighbours) : trimRight(c, t, m, neighbours));
    }
  });
}

/** Delete key: selected clips, otherwise the selected track. */
export function deleteSelection() {
  const ids = getSelectedClipIds();
  if (ids.length) {
    const removed = project().deleteClips(ids);
    if (removed < ids.length) notify('Clips on locked tracks were not deleted.', 'warning');
    ui().setSelection({ kind: 'none' });
    return;
  }
  const sel = ui().selection;
  if (sel.kind === 'transition') {
    project().removeTransition(sel.id);
    ui().setSelection({ kind: 'none' });
    return;
  }
  if (sel.kind === 'track') {
    const track = project().document.tracks.find((t) => t.id === sel.id);
    if (track && !track.isMain) {
      project().removeTrack(track.id);
      ui().setSelection({ kind: 'none' });
    }
  }
}

/** Duplicates selected clips right after themselves (next free slot on the same track). */
export function duplicateSelection() {
  const clips = getSelectedClipIds().map((id) => project().document.clips[id]);
  if (!clips.length) return;
  const created = project().insertClipCopies(clips.map((c) => ({ ...c, start: clipEnd(c) })));
  if (created.length) selectClips(created);
}

export function copySelection() {
  const clips = getSelectedClipIds().map((id) => project().document.clips[id]);
  if (!clips.length) return;
  ui().setClipboard(clips.map((c) => ({ ...c, transform: { ...c.transform } })));
  notify(`Copied ${clips.length} clip${clips.length === 1 ? '' : 's'}.`, 'info');
}

/** Pastes copied clips at the playhead, keeping their relative timing and tracks. */
export function pasteClipboard() {
  const clipboard = ui().clipboard;
  if (!clipboard.length) return;
  const doc = project().document;
  const at = usePlaybackStore.getState().timelineTime;
  const earliest = Math.min(...clipboard.map((c) => c.start));
  const placeable: Clip[] = [];
  for (const c of clipboard) {
    const track = doc.tracks.find((t) => t.id === c.trackId && !t.locked);
    if (!track) continue;
    placeable.push({ ...c, start: at + (c.start - earliest) });
  }
  if (!placeable.length) {
    notify('The original tracks of the copied clips no longer exist or are locked.', 'warning');
    return;
  }
  const created = project().insertClipCopies(placeable);
  if (created.length) selectClips(created);
}

/** Seeks the timeline (switching the preview back to the timeline first). */
export function seekTimeline(time: number) {
  ui().showTimeline();
  previewEngine.seek(time);
}
