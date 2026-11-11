import { CopyPlus, Magnet, Maximize2, Plus, Scissors, SquareMinus, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore, ZOOM_LEVELS } from '../../store/uiStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { deleteSelection, duplicateSelection, splitSelectedAtPlayhead } from '../../services/editingService';
import { canSplitAt, quantizeToFrame } from '../../engine/timelineModel';
import { formatTimecode } from '../../utils/format';
import { IconButton } from '../controls/IconButton';
import { AddTrackMenu } from './AddTrackMenu';

/** Isolated so only this text re-renders as the playhead moves. */
function PlayheadTimecode({ fps }: { fps: number }) {
  const playhead = usePlaybackStore((s) => s.timelineTime);
  return <div className="font-mono text-[11px] tabular-nums text-fg-muted">{formatTimecode(playhead, fps)}</div>;
}

interface TimelineToolbarProps {
  onFit: () => void;
}

export function TimelineToolbar({ onFit }: TimelineToolbarProps) {
  const zoom = useUiStore((s) => s.timelineZoom);
  const zoomTimeline = useUiStore((s) => s.zoomTimeline);
  const setZoom = useUiStore((s) => s.setTimelineZoom);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const snapping = useUiStore((s) => s.snapping);
  const setSnapping = useUiStore((s) => s.setSnapping);
  const tracks = useProjectStore((s) => s.document.tracks);
  const clips = useProjectStore((s) => s.document.clips);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const fps = useProjectStore((s) => s.document.canvas.frameRate);

  const selectedTrack = selection.kind === 'track' ? tracks.find((t) => t.id === selection.id) : undefined;
  const selectedClips = selection.kind === 'clips' ? selection.ids.map((id) => clips[id]).filter(Boolean) : [];
  const lockedIds = new Set(tracks.filter((t) => t.locked).map((t) => t.id));
  const editableClips = selectedClips.filter((c) => !lockedIds.has(c.trackId));
  // Boolean selector: the toolbar re-renders when split availability changes, not every frame.
  const canSplit = usePlaybackStore((s) => editableClips.some((c) => canSplitAt(c, quantizeToFrame(s.timelineTime, fps))));
  const canDeleteTrack = !!selectedTrack && !selectedTrack.isMain;

  const zoomIndex = ZOOM_LEVELS.findIndex((l) => Math.abs(l - zoom) < 1e-6);
  const sliderIndex = zoomIndex >= 0 ? zoomIndex : ZOOM_LEVELS.findIndex((l) => l > zoom);

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-0.5">
        <IconButton icon={Scissors} label="Split at playhead" shortcut="S" disabled={!canSplit} onClick={splitSelectedAtPlayhead} />
        <IconButton icon={CopyPlus} label="Duplicate clip" shortcut="Ctrl+D" disabled={!editableClips.length} onClick={duplicateSelection} />
        <IconButton icon={Trash2} label="Delete clip" shortcut="Del" disabled={!editableClips.length} onClick={deleteSelection} />
        <div className="mx-1.5 h-4 w-px bg-line" />
        <AddTrackMenu
          trigger={(toggle, open) => (
            <IconButton icon={Plus} label="Add track" active={open} onClick={toggle} className="px-2">
              <span className="text-[11px]">Track</span>
            </IconButton>
          )}
        />
        <IconButton
          icon={SquareMinus}
          label={selectedTrack?.isMain ? 'The main track cannot be deleted' : 'Delete selected track'}
          disabled={!canDeleteTrack}
          onClick={() => {
            if (!selectedTrack) return;
            removeTrack(selectedTrack.id);
            setSelection({ kind: 'none' });
          }}
        />
        <div className="mx-1.5 h-4 w-px bg-line" />
        <IconButton
          icon={Magnet}
          label={snapping ? 'Snapping on' : 'Snapping off'}
          active={snapping}
          onClick={() => setSnapping(!snapping)}
        />
        <span className="ml-2 hidden text-[11px] text-fg-subtle lg:inline">
          {selectedClips.length
            ? `${selectedClips.length} clip${selectedClips.length === 1 ? '' : 's'} selected`
            : selectedTrack
              ? `Track: ${selectedTrack.name}`
              : `${Object.keys(clips).length} clips · ${tracks.length} tracks`}
        </span>
      </div>

      <PlayheadTimecode fps={fps} />

      <div className="flex items-center gap-1">
        <IconButton icon={ZoomOut} label="Zoom out" shortcut="-" disabled={zoom <= ZOOM_LEVELS[0]} onClick={() => zoomTimeline(-1)} />
        <input
          type="range"
          aria-label="Timeline zoom"
          min={0}
          max={ZOOM_LEVELS.length - 1}
          step={1}
          value={Math.max(0, sliderIndex)}
          onChange={(e) => setZoom(ZOOM_LEVELS[Number(e.target.value)])}
          className="range w-24"
          style={{ ['--fill' as string]: `${(Math.max(0, sliderIndex) / (ZOOM_LEVELS.length - 1)) * 100}%` }}
        />
        <IconButton icon={ZoomIn} label="Zoom in" shortcut="=" disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} onClick={() => zoomTimeline(1)} />
        <span className="w-10 text-right font-mono text-[10px] text-fg-subtle">{Math.round(zoom * 100)}%</span>
        <IconButton icon={Maximize2} label="Zoom to fit" onClick={onFit} />
      </div>
    </div>
  );
}
