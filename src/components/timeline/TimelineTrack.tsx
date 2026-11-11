import { memo, useState } from 'react';
import { InlineTextInput } from '../controls/InlineTextInput';
import { ArrowRightLeft, Eye, EyeOff, Lock, Unlock, Volume2, VolumeX } from 'lucide-react';
import type { Clip, MediaItem, Track } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { cn } from '../../utils/cn';
import { IconButton } from '../controls/IconButton';
import { HEADER_WIDTH, TRACK_COLOR_VAR, TRACK_HEIGHT, TRACK_ICON } from './timelineConfig';
import { TimelineClip } from './TimelineClip';
import type { ClipDragMode } from './useClipDrag';
import type { DropGhost } from './dragStore';

/** A transition drawn on this lane, centred on its cut. */
export interface LaneTransition {
  id: string;
  name: string;
  at: number;
  duration: number;
}

export interface LaneDragHandlers {
  onDragOver: (e: React.DragEvent<HTMLDivElement>, trackId: string) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, trackId: string) => void;
}

interface TimelineTrackProps {
  track: Track;
  selected: boolean;
  contentWidth: number;
  pps: number;
  /** Clips to show on this lane (with live drag previews applied). */
  clips: Clip[];
  mediaById: Map<string, MediaItem>;
  selectedClipIds: ReadonlySet<string>;
  draggingClipIds: ReadonlySet<string>;
  ghost: DropGhost | null;
  transitions: LaneTransition[];
  selectedTransitionId: string | null;
  onSelectTransition: (id: string) => void;
  /** Cut highlighted while a transition is dragged over this lane. */
  cutHint: { at: number; valid: boolean } | null;
  /** Clip highlighted while an effect / filter is dragged over it. */
  dropClipId: string | null;
  onSelect: (id: string) => void;
  onLanePointerDown: (e: React.PointerEvent<HTMLDivElement>, trackId: string) => void;
  onClipPointerDown: (e: React.PointerEvent<HTMLElement>, clipId: string, mode: ClipDragMode) => void;
  dragHandlers: LaneDragHandlers;
}

function TrackName({ track }: { track: Track }) {
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <InlineTextInput
        autoSelect
        value={track.name}
        maxLength={40}
        aria-label="Track name"
        onCommit={(name) => renameTrack(track.id, name)}
        onDone={() => setEditing(false)}
        className="field h-5! min-w-0 px-1! text-[11px]"
      />
    );
  }
  return (
    <span
      className="truncate text-[11px] text-fg"
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {track.name}
    </span>
  );
}

export function DropGhostView({ ghost, pps, height }: { ghost: DropGhost; pps: number; height: number }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-[2px] z-[7] rounded-[5px] border-2 border-dashed',
        ghost.valid ? 'border-accent bg-accent/20' : 'border-danger bg-danger/15',
      )}
      style={{ left: ghost.start * pps, width: Math.max(4, ghost.duration * pps), height: height - 4 }}
    />
  );
}

export const TimelineTrack = memo(function TimelineTrack({
  track,
  selected,
  contentWidth,
  pps,
  clips,
  mediaById,
  selectedClipIds,
  draggingClipIds,
  ghost,
  transitions,
  selectedTransitionId,
  onSelectTransition,
  cutHint,
  dropClipId,
  onSelect,
  onLanePointerDown,
  onClipPointerDown,
  dragHandlers,
}: TimelineTrackProps) {
  const toggle = useProjectStore((s) => s.toggleTrackFlag);
  const Icon = TRACK_ICON[track.type];
  const color = TRACK_COLOR_VAR[track.type];
  const height = TRACK_HEIGHT[track.type];
  const canHide = track.type !== 'audio';
  const canMute = track.type !== 'text';
  const dimmed = track.hidden || (track.type === 'audio' && track.muted);

  return (
    <div className="flex border-b border-line" style={{ height }} data-track-id={track.id}>
      {/* Header (sticky on horizontal scroll) */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Select ${track.name}`}
        onClick={() => onSelect(track.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(track.id)}
        className={cn(
          'group sticky left-0 z-20 flex shrink-0 cursor-pointer items-center gap-2 border-r border-line pl-0 pr-1.5 transition-colors',
          selected ? 'bg-panel-3' : 'bg-panel hover:bg-panel-2',
        )}
        style={{ width: HEADER_WIDTH }}
      >
        <span className="h-full w-[3px] shrink-0" style={{ background: selected ? color : 'transparent' }} />
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
        >
          <Icon size={13} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <TrackName track={track} />
          {track.isMain && <span className="text-[9px] uppercase tracking-wider text-fg-subtle">Main</span>}
        </div>
        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {canHide && (
            <IconButton
              size="sm"
              icon={track.hidden ? EyeOff : Eye}
              label={track.hidden ? 'Show track' : 'Hide track'}
              active={track.hidden}
              onClick={() => toggle(track.id, 'hidden')}
            />
          )}
          {canMute && (
            <IconButton
              size="sm"
              icon={track.muted ? VolumeX : Volume2}
              label={track.muted ? 'Unmute track' : 'Mute track'}
              active={track.muted}
              onClick={() => toggle(track.id, 'muted')}
            />
          )}
          <IconButton
            size="sm"
            icon={track.locked ? Lock : Unlock}
            label={track.locked ? 'Unlock track' : 'Lock track'}
            active={track.locked}
            onClick={() => toggle(track.id, 'locked')}
          />
        </div>
      </div>

      {/* Lane */}
      <div
        data-lane-track-id={track.id}
        className={cn(
          'relative transition-colors',
          selected ? 'bg-white/[0.035]' : 'bg-transparent',
          track.locked && 'lane-locked',
          dimmed && 'opacity-50',
        )}
        style={{ width: contentWidth }}
        onPointerDown={(e) => onLanePointerDown(e, track.id)}
        onDragOver={(e) => dragHandlers.onDragOver(e, track.id)}
        onDragLeave={dragHandlers.onDragLeave}
        onDrop={(e) => dragHandlers.onDrop(e, track.id)}
      >
        {track.isMain && clips.length === 0 && !ghost && (
          <div
            className="pointer-events-none absolute inset-y-2 left-2 flex items-center rounded-md border border-dashed px-3 text-[11px]"
            style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, color: `color-mix(in srgb, ${color} 70%, #888)` }}
          >
            Drag media here, or click + on a media item
          </div>
        )}
        {clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            media={mediaById.get(clip.mediaId)}
            trackType={track.type}
            height={height}
            pps={pps}
            selected={selectedClipIds.has(clip.id)}
            locked={track.locked}
            dragging={draggingClipIds.has(clip.id)}
            dropTarget={dropClipId === clip.id}
            onPointerDown={onClipPointerDown}
          />
        ))}
        {transitions.map((tr) => {
          const w = Math.max(14, tr.duration * pps);
          const selectedTr = tr.id === selectedTransitionId;
          return (
            <div
              key={tr.id}
              role="button"
              aria-label={`Transition ${tr.name}`}
              aria-selected={selectedTr}
              data-transition-id={tr.id}
              title={`${tr.name} · ${tr.duration.toFixed(2)}s (click to edit)`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) onSelectTransition(tr.id);
              }}
              className={cn(
                'absolute top-1/2 z-[8] flex h-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded border text-white shadow',
                selectedTr ? 'border-white bg-accent' : 'border-white/60 bg-black/65 hover:bg-accent/80',
              )}
              style={{ left: tr.at * pps - w / 2, width: w }}
            >
              <ArrowRightLeft size={11} />
            </div>
          );
        })}
        {cutHint && (
          <div
            className={cn('pointer-events-none absolute inset-y-0 z-[9] w-[3px] -translate-x-1/2 rounded', cutHint.valid ? 'bg-accent' : 'bg-danger')}
            style={{ left: cutHint.at * pps }}
          />
        )}
        {ghost && <DropGhostView ghost={ghost} pps={pps} height={height} />}
      </div>
    </div>
  );
});
