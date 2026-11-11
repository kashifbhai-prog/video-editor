import { useCallback } from 'react';
import { trackFamily, useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { usePlaybackStore } from '../../store/playbackStore';
import {
  clipDuration,
  clipEnd,
  clipsOnTrack,
  isRangeFree,
  quantizeToFrame,
  resolvePlacement,
  snapTime,
  trimLeft,
  trimRight,
} from '../../engine/timelineModel';
import { getSelectedClipIds, selectClip, selectClips } from '../../services/editingService';
import { clearDrag, useDragStore, type ClipPreview } from './dragStore';

export type ClipDragMode = 'move' | 'trim-left' | 'trim-right';

const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 3;

/** Finds the lane under the pointer (ignoring the dragged clip itself). */
function laneTrackIdAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = (el as HTMLElement).dataset?.laneTrackId;
    if (id) return id;
  }
  return null;
}

/**
 * Pointer interaction for timeline clips: click to select (Ctrl/Shift to
 * toggle), drag body to move (also across compatible tracks), drag edges to trim.
 * Geometry is previewed live in the drag store and committed once on release.
 */
export function useClipDrag(pps: number) {
  return useCallback(
    (e: React.PointerEvent<HTMLElement>, clipId: string, mode: ClipDragMode) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const doc = useProjectStore.getState().document;
      const clip = doc.clips[clipId];
      if (!clip) return;

      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        selectClip(clipId, true);
        return;
      }
      const selected = getSelectedClipIds();
      const groupIds = mode === 'move' && selected.includes(clipId) ? selected : [clipId];
      selectClips(groupIds);

      const isLocked = (trackId: string) => !!doc.tracks.find((t) => t.id === trackId)?.locked;
      const dragging = groupIds.map((id) => doc.clips[id]).filter((c) => c && !isLocked(c.trackId));
      if (!dragging.some((c) => c.id === clipId)) return; // primary is on a locked track

      const draggingIds = new Set(dragging.map((c) => c.id));
      const media = useMediaStore.getState().items.find((m) => m.id === clip.mediaId);
      const playhead = usePlaybackStore.getState().timelineTime;
      const snapPoints = [
        0,
        playhead,
        ...Object.values(doc.clips)
          .filter((c) => !draggingIds.has(c.id))
          .flatMap((c) => [c.start, clipEnd(c)]),
      ];
      const snapThreshold = SNAP_PX / pps;
      const fps = doc.canvas.frameRate;
      const sourceTrack = doc.tracks.find((t) => t.id === clip.trackId)!;
      const origin = { x: e.clientX, y: e.clientY };
      let moved = false;

      // Listen on window, not the element: when a clip is dragged onto another
      // track React re-mounts it under a different lane, and the original element
      // (with its pointer capture) is removed from the DOM mid-drag.
      const pointerId = e.pointerId;

      const snap = (t: number) => {
        if (!useUiStore.getState().snapping) return { time: t, snapped: false };
        return snapTime(t, snapPoints, snapThreshold);
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
        moved = true;
        const dx = (ev.clientX - origin.x) / pps;
        const previews: Record<string, ClipPreview> = {};
        let snapAt: number | null = null;

        if (mode === 'move') {
          let delta = dx;
          // Snap whichever edge of the grabbed clip is closer to a snap point.
          const sStart = snap(clip.start + delta);
          const sEnd = snap(clipEnd(clip) + delta);
          if (sStart.snapped && (!sEnd.snapped || Math.abs(sStart.time - clip.start - delta) <= Math.abs(sEnd.time - clipEnd(clip) - delta))) {
            delta = sStart.time - clip.start;
            snapAt = sStart.time;
          } else if (sEnd.snapped) {
            delta = sEnd.time - clipEnd(clip);
            snapAt = sEnd.time;
          } else {
            // Not snapped: land the grabbed clip's start on the frame grid.
            delta = quantizeToFrame(clip.start + delta, fps) - clip.start;
          }
          delta = Math.max(delta, -Math.min(...dragging.map((c) => c.start)));

          let trackId = clip.trackId;
          if (dragging.length === 1) {
            const hovered = laneTrackIdAt(ev.clientX, ev.clientY);
            const ht = hovered && doc.tracks.find((t) => t.id === hovered);
            if (ht && !ht.locked && trackFamily(ht.type) === trackFamily(sourceTrack.type)) trackId = ht.id;
          }
          for (const c of dragging) {
            previews[c.id] = {
              start: c.start + delta,
              trackId: c.id === clip.id ? trackId : c.trackId,
              sourceIn: c.sourceIn,
              sourceOut: c.sourceOut,
            };
          }
        } else {
          const neighbours = clipsOnTrack(doc, clip.trackId);
          if (mode === 'trim-left') {
            const s = snap(quantizeToFrame(clip.start + dx, fps));
            const r = trimLeft(clip, s.time, media, neighbours);
            if (s.snapped && Math.abs(r.start - s.time) < 1e-6) snapAt = s.time;
            previews[clip.id] = { ...r, trackId: clip.trackId };
          } else {
            const s = snap(quantizeToFrame(clipEnd(clip) + dx, fps));
            const r = trimRight(clip, s.time, media, neighbours);
            const end = r.start + (r.sourceOut - r.sourceIn) / clip.speed;
            if (s.snapped && Math.abs(end - s.time) < 1e-6) snapAt = s.time;
            previews[clip.id] = { ...r, trackId: clip.trackId };
          }
        }
        useDragStore.setState({ previews, snapAt });
      };

      const finish = (commit: boolean) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        const { previews } = useDragStore.getState();
        clearDrag();
        if (!commit || !moved || !previews[clip.id]) return;
        const project = useProjectStore.getState();

        if (mode !== 'move') {
          const p = previews[clip.id];
          project.setClipTiming(clip.id, { start: p.start, sourceIn: p.sourceIn, sourceOut: p.sourceOut });
          return;
        }
        if (dragging.length === 1) {
          // Single clip: land in the nearest free slot of the target track.
          const p = previews[clip.id];
          const others = clipsOnTrack(doc, p.trackId, draggingIds);
          const start = resolvePlacement(others, p.start, clipDuration(clip));
          project.moveClips([{ id: clip.id, start, trackId: p.trackId }]);
          return;
        }
        // Group move keeps relative timing; refuse if it would overlap others.
        const moves = dragging.map((c) => ({ id: c.id, start: previews[c.id].start, trackId: previews[c.id].trackId }));
        const fits = moves.every((m) => {
          const c = doc.clips[m.id];
          return isRangeFree(clipsOnTrack(doc, m.trackId, draggingIds), m.start, clipDuration(c));
        });
        if (!fits || !project.moveClips(moves)) {
          useUiStore.getState().notify('The selected clips would overlap other clips – move cancelled.', 'warning');
        }
      };
      const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
      const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
      // Escape cancels the drag (captured first so it doesn't also clear the selection).
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        ev.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
    },
    [pps],
  );
}
