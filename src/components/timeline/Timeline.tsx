import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { BASE_PX_PER_SECOND, pxPerSecond, useUiStore } from '../../store/uiStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { previewEngine } from '../../engine/previewEngine';
import { clipDuration, clipEnd, clipsOnTrack, defaultClipLength, quantizeToFrame, resolvePlacement, sequenceDuration, trackAccepts } from '../../engine/timelineModel';
import { dropMediaOnNewTrack, dropMediaOnTrack } from '../../services/editingService';
import { addEffect, applyFilter, applyTransition, cutNear } from '../../services/advancedEditing';
import { transitionBlocker } from '../../store/projectStore';
import { transitionDef } from '../../engine/catalog';
import { useElementSize } from '../../hooks/useElementSize';
import type { Clip, MediaItem } from '../../types';
import { TimelineToolbar } from './TimelineToolbar';
import { TimelineRuler } from './TimelineRuler';
import { DropGhostView, TimelineTrack, type LaneDragHandlers, type LaneTransition } from './TimelineTrack';
import { AddTrackMenu } from './AddTrackMenu';
import { useClipDrag } from './useClipDrag';
import {
  clearDrag,
  getDraggedLibraryItem,
  getDraggedMedia,
  LIBRARY_DRAG_MIME,
  MEDIA_DRAG_MIME,
  setDraggedLibraryItem,
  useDragStore,
  useLibraryDropHint,
  type LibraryDragItem,
} from './dragStore';
import { HEADER_WIDTH, MIN_TIMELINE_SECONDS, RULER_HEIGHT, TIMELINE_TAIL_SECONDS } from './timelineConfig';

function usePlayheadX(pps: number) {
  return usePlaybackStore((s) => s.timelineTime) * pps;
}

/** Vertical playhead line across the tracks (passes beneath sticky track headers). */
function PlayheadLine({ pps }: { pps: number }) {
  const x = usePlayheadX(pps);
  return (
    <div
      className="pointer-events-none absolute bottom-0 z-[15] w-px bg-accent"
      style={{ left: HEADER_WIDTH + x, top: RULER_HEIGHT }}
    />
  );
}

/** Playhead marker drawn inside the ruler. */
function PlayheadHead({ pps }: { pps: number }) {
  const x = usePlayheadX(pps);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent" style={{ left: x }}>
      <svg width="11" height="12" viewBox="0 0 11 12" className="absolute -left-[5px] top-0 fill-accent">
        <path d="M0 0h11v7l-5.5 5L0 7z" />
      </svg>
    </div>
  );
}

/** Guide line shown while a drag snaps to an edge or the playhead. */
function SnapGuide({ pps }: { pps: number }) {
  const at = useDragStore((s) => s.snapAt);
  if (at === null) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-0 z-[16] w-px bg-warning"
      style={{ left: HEADER_WIDTH + at * pps, top: RULER_HEIGHT }}
    />
  );
}

const EMPTY: Clip[] = [];
const NO_TRANSITIONS: LaneTransition[] = [];
/** How close (px) a transition must be dropped to a cut. */
const CUT_SNAP_PX = 16;

export function Timeline() {
  const tracks = useProjectStore((s) => s.document.tracks);
  const clipsMap = useProjectStore((s) => s.document.clips);
  const mediaItems = useMediaStore((s) => s.items);
  const zoom = useUiStore((s) => s.timelineZoom);
  const setZoom = useUiStore((s) => s.setTimelineZoom);
  const zoomTimeline = useUiStore((s) => s.zoomTimeline);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const previews = useDragStore((s) => s.previews);
  const transitionsMap = useProjectStore((s) => s.document.transitions);
  const dropHint = useLibraryDropHint((s) => s.hint);
  const ghost = useDragStore((s) => s.ghost);

  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useElementSize(scrollRef);
  const [scrollLeft, setScrollLeft] = useState(0);

  const pps = pxPerSecond(zoom);
  const editDuration = useMemo(() => sequenceDuration({ clips: clipsMap }), [clipsMap]);
  const laneViewport = Math.max(0, viewport.width - HEADER_WIDTH);
  const totalSeconds = Math.max(
    MIN_TIMELINE_SECONDS,
    editDuration + TIMELINE_TAIL_SECONDS,
    Math.ceil(laneViewport / pps),
  );
  const contentWidth = totalSeconds * pps;

  const mediaById = useMemo(() => new Map(mediaItems.map((m) => [m.id, m])), [mediaItems]);
  const selectedClipIds = useMemo(
    () => new Set(selection.kind === 'clips' ? selection.ids : []),
    [selection],
  );
  const draggingClipIds = useMemo(() => new Set(Object.keys(previews)), [previews]);

  /** Transitions per track, centred on their cut (duration clamped like the engine does). */
  const transitionsByTrack = useMemo(() => {
    const map = new Map<string, LaneTransition[]>();
    for (const tr of Object.values(transitionsMap ?? {})) {
      const a = clipsMap[tr.fromClipId];
      const b = clipsMap[tr.toClipId];
      if (!a || !b) continue;
      const list = map.get(a.trackId) ?? [];
      list.push({ id: tr.id, name: transitionDef(tr.type).name, at: b.start, duration: Math.min(tr.duration, clipDuration(a), clipDuration(b)) });
      map.set(a.trackId, list);
    }
    return map;
  }, [transitionsMap, clipsMap]);
  const selectedTransitionId = selection.kind === 'transition' ? selection.id : null;
  const onSelectTransition = useCallback((id: string) => setSelection({ kind: 'transition', id }), [setSelection]);

  /** Clips per track with live drag previews applied. Untouched clips keep identity (memo-friendly). */
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const clip of Object.values(clipsMap)) {
      const p = previews[clip.id];
      const effective = p ? { ...clip, ...p } : clip;
      const list = map.get(effective.trackId) ?? [];
      list.push(effective);
      map.set(effective.trackId, list);
    }
    return map;
  }, [clipsMap, previews]);

  // Keep the playhead anchored on screen when zoom changes.
  const prevPps = useRef(pps);
  /** Set by "zoom to fit", which should show the timeline from 0s instead. */
  const scrollToStartOnZoom = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevPps.current === pps) return;
    if (scrollToStartOnZoom.current) {
      scrollToStartOnZoom.current = false;
      el.scrollLeft = 0;
    } else {
      const t = usePlaybackStore.getState().timelineTime;
      const screenX = t * prevPps.current - el.scrollLeft;
      const anchor = screenX >= 0 && screenX <= laneViewport ? screenX : 0;
      el.scrollLeft = Math.max(0, t * pps - anchor);
    }
    prevPps.current = pps;
  }, [pps, laneViewport]);

  // Auto-scroll to follow the playhead during playback.
  useEffect(() => {
    if (!isPlaying) return;
    return usePlaybackStore.subscribe((s) => {
      const el = scrollRef.current;
      if (!el) return;
      const x = s.timelineTime * pps;
      if (x > el.scrollLeft + laneViewport - 40 || x < el.scrollLeft) {
        el.scrollLeft = Math.max(0, x - 40);
      }
    });
  }, [isPlaying, pps, laneViewport]);

  /** Converts a pointer position into timeline seconds, on the project's frame grid. */
  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - HEADER_WIDTH + el.scrollLeft;
      return quantizeToFrame(x / pps, useProjectStore.getState().document.canvas.frameRate);
    },
    [pps],
  );

  const beginScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      useUiStore.getState().showTimeline();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const wasPlaying = usePlaybackStore.getState().isPlaying;
      if (wasPlaying) previewEngine.pause();
      previewEngine.seek(timeFromClientX(e.clientX));
      const move = (ev: PointerEvent) => previewEngine.seek(timeFromClientX(ev.clientX));
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        if (wasPlaying) previewEngine.play();
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [timeFromClientX],
  );

  const onSelectTrack = useCallback((id: string) => setSelection({ kind: 'track', id }), [setSelection]);
  const onLanePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, trackId: string) => {
      setSelection({ kind: 'track', id: trackId });
      beginScrub(e);
    },
    [setSelection, beginScrub],
  );

  const onClipPointerDown = useClipDrag(pps);

  // ---- Library → timeline drag & drop ------------------------------------
  const ghostFor = useCallback(
    (media: MediaItem, trackId: string, clientX: number) => {
      const doc = useProjectStore.getState().document;
      const length = defaultClipLength(media);
      const time = timeFromClientX(clientX);
      if (trackId === 'new') return { trackId, start: time, duration: length, valid: true };
      const track = doc.tracks.find((t) => t.id === trackId);
      const valid = !!track && !track.locked && trackAccepts(track.type, media.kind);
      const start = valid ? resolvePlacement(clipsOnTrack(doc, trackId), time, length) : time;
      return { trackId, start, duration: length, valid };
    },
    [timeFromClientX],
  );

  /** Where a dragged transition / effect / filter would land on a lane. */
  const libraryHint = useCallback(
    (lib: LibraryDragItem, trackId: string, clientX: number) => {
      const el = scrollRef.current;
      if (!el) return null;
      const x = clientX - el.getBoundingClientRect().left - HEADER_WIDTH + el.scrollLeft;
      const time = x / pps;
      const doc = useProjectStore.getState().document;
      if (lib.kind === 'transition') {
        const cut = cutNear(trackId, time, CUT_SNAP_PX / pps);
        if (!cut) return null;
        return { cut: { trackId, at: cut.at, valid: !transitionBlocker(doc, cut.from.id, cut.to.id) } };
      }
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.type === 'audio' || track.locked) return null;
      const clip = clipsOnTrack(doc, trackId).find((c) => time >= c.start && time < clipEnd(c));
      return clip ? { clipId: clip.id } : null;
    },
    [pps],
  );

  const dragHandlers: LaneDragHandlers = useMemo(
    () => ({
      onDragOver: (e, trackId) => {
        const lib = getDraggedLibraryItem();
        if (lib && e.dataTransfer.types.includes(LIBRARY_DRAG_MIME)) {
          if (trackId === 'new') return;
          const hint = libraryHint(lib, trackId, e.clientX);
          if (hint && (hint.cut?.valid ?? true)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
          useLibraryDropHint.setState({ hint });
          return;
        }
        const media = getDraggedMedia();
        if (!media || !e.dataTransfer.types.includes(MEDIA_DRAG_MIME)) return;
        const g = ghostFor(media, trackId, e.clientX);
        if (g.valid) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
        useDragStore.setState({ ghost: g });
      },
      onDragLeave: (e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          useDragStore.setState({ ghost: null });
          useLibraryDropHint.setState({ hint: null });
        }
      },
      onDrop: (e, trackId) => {
        const libRaw = e.dataTransfer.getData(LIBRARY_DRAG_MIME);
        if (libRaw) {
          e.preventDefault();
          let lib: LibraryDragItem | null = null;
          try {
            lib = JSON.parse(libRaw) as LibraryDragItem;
          } catch {
            lib = null;
          }
          const hint = lib && trackId !== 'new' ? libraryHint(lib, trackId, e.clientX) : null;
          setDraggedLibraryItem(null);
          if (!lib || !hint) return;
          if (lib.kind === 'transition' && hint.cut) {
            const doc = useProjectStore.getState().document;
            const cut = cutNear(trackId, hint.cut.at, 1e-3);
            if (!cut) return;
            const blocker = transitionBlocker(doc, cut.from.id, cut.to.id);
            if (blocker) useUiStore.getState().notify(blocker, 'warning');
            else applyTransition(cut.from.id, cut.to.id, lib.type);
          } else if (lib.kind === 'effect' && hint.clipId) {
            addEffect(lib.type, [hint.clipId]);
          } else if (lib.kind === 'filter' && hint.clipId) {
            applyFilter(lib.presetId, [hint.clipId]);
          }
          return;
        }
        const mediaId = e.dataTransfer.getData(MEDIA_DRAG_MIME);
        if (!mediaId) return;
        e.preventDefault();
        const time = timeFromClientX(e.clientX);
        clearDrag();
        if (trackId === 'new') dropMediaOnNewTrack(mediaId, time);
        else dropMediaOnTrack(mediaId, trackId, time);
      },
    }),
    [ghostFor, timeFromClientX, libraryHint],
  );

  const fitToView = useCallback(() => {
    const target = Math.max(editDuration, 10);
    scrollToStartOnZoom.current = true;
    setZoom((laneViewport - 24) / (target * BASE_PX_PER_SECOND));
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    // If the zoom did not change, the layout effect never consumed the flag.
    requestAnimationFrame(() => (scrollToStartOnZoom.current = false));
  }, [editDuration, laneViewport, setZoom]);

  // Ctrl/⌘ + wheel zooms the timeline.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTimeline(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTimeline]);

  return (
    <section aria-label="Timeline" className="flex h-full min-h-0 flex-col bg-panel">
      <TimelineToolbar onFit={fitToView} />
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        className="scroll-thin relative min-h-0 flex-1 overflow-auto bg-[#121316]"
      >
        <div className="relative min-h-full" style={{ width: HEADER_WIDTH + contentWidth }}>
          {/* Ruler row */}
          <div className="sticky top-0 z-30 flex border-b border-line bg-panel" style={{ height: RULER_HEIGHT }}>
            <div
              className="sticky left-0 z-40 flex shrink-0 items-center border-r border-line bg-panel px-3 text-[10px] uppercase tracking-wider text-fg-subtle"
              style={{ width: HEADER_WIDTH }}
            >
              Tracks
            </div>
            <div className="relative">
              <TimelineRuler
                pxPerSecond={pps}
                totalSeconds={totalSeconds}
                viewStart={scrollLeft}
                viewWidth={laneViewport}
                onScrubStart={beginScrub}
              />
              <PlayheadHead pps={pps} />
            </div>
          </div>

          {/* Tracks */}
          {tracks.map((track) => (
            <TimelineTrack
              key={track.id}
              track={track}
              selected={selection.kind === 'track' && selection.id === track.id}
              contentWidth={contentWidth}
              pps={pps}
              clips={clipsByTrack.get(track.id) ?? EMPTY}
              mediaById={mediaById}
              selectedClipIds={selectedClipIds}
              draggingClipIds={draggingClipIds}
              ghost={ghost?.trackId === track.id ? ghost : null}
              transitions={transitionsByTrack.get(track.id) ?? NO_TRANSITIONS}
              selectedTransitionId={selectedTransitionId}
              onSelectTransition={onSelectTransition}
              cutHint={dropHint?.cut?.trackId === track.id ? dropHint.cut : null}
              dropClipId={dropHint?.clipId ?? null}
              onSelect={onSelectTrack}
              onLanePointerDown={onLanePointerDown}
              onClipPointerDown={onClipPointerDown}
              dragHandlers={dragHandlers}
            />
          ))}

          {/* Add track row – also a drop zone that creates a fitting track */}
          <div className="flex h-11">
            <div className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-panel px-2" style={{ width: HEADER_WIDTH }}>
              <AddTrackMenu
                className="flex w-full"
                trigger={(toggle, open) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className="flex h-6 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-fg"
                  >
                    <Plus size={12} />
                    Add track
                  </button>
                )}
              />
            </div>
            <div
              data-new-track-zone
              className="relative flex-1"
              onDragOver={(e) => dragHandlers.onDragOver(e, 'new')}
              onDragLeave={dragHandlers.onDragLeave}
              onDrop={(e) => dragHandlers.onDrop(e, 'new')}
            >
              {ghost?.trackId === 'new' ? (
                <DropGhostView ghost={ghost} pps={pps} height={44} />
              ) : (
                <span className="pointer-events-none sticky left-2 top-0 flex h-full items-center pl-2 text-[10px] text-fg-subtle">
                  Drop media here to create a new track
                </span>
              )}
            </div>
          </div>

          <PlayheadLine pps={pps} />
          <SnapGuide pps={pps} />
        </div>
      </div>
    </section>
  );
}
