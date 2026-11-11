import { memo, useEffect, useState } from 'react';
import { AlertTriangle, Rewind, Sparkles, Type } from 'lucide-react';
import type { Clip, MediaItem, TrackType } from '../../types';
import { clipDuration } from '../../engine/timelineModel';
import { keyframeTimes } from '../../engine/animation';
import { moveKeyframesAt } from '../../services/advancedEditing';
import { previewEngine } from '../../engine/previewEngine';
import { useUiStore } from '../../store/uiStore';
import { requestFilmstrip, useFilmstripStore } from '../../services/filmstrip';
import { formatDuration } from '../../utils/format';
import { cn } from '../../utils/cn';
import { Waveform } from '../media/MediaItemView';
import { TRACK_COLOR_VAR } from './timelineConfig';
import type { ClipDragMode } from './useClipDrag';

interface TimelineClipProps {
  clip: Clip;
  media: MediaItem | undefined;
  trackType: TrackType;
  height: number;
  pps: number;
  selected: boolean;
  locked: boolean;
  dragging: boolean;
  /** Highlighted as the drop target of an effect / filter drag. */
  dropTarget?: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, clipId: string, mode: ClipDragMode) => void;
}

const MAX_TILES = 60;

function Filmstrip({ clip, media, width, height, pps }: { clip: Clip; media: MediaItem; width: number; height: number; pps: number }) {
  const strip = useFilmstripStore((s) => s.strips[media.id]);
  useEffect(() => requestFilmstrip(media), [media]);
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  let tileW = Math.max(24, height * aspect);
  const count = Math.max(1, Math.min(MAX_TILES, Math.ceil(width / tileW)));
  if (count === MAX_TILES) tileW = width / count;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        // Sample the middle of the tile's *visible* part – the last tile (or a
        // single tile on a short clip) can extend past the clip's end.
        const visibleCentre = (i * tileW + Math.min((i + 1) * tileW, width)) / 2;
        const offset = (visibleCentre / pps) * clip.speed;
        const srcTime = clip.reversed ? clip.sourceOut - offset : clip.sourceIn + offset;
        const frame = strip?.frames[Math.min(strip.frames.length - 1, Math.max(0, Math.floor(srcTime / strip.interval)))];
        const src = frame ?? media.thumbnail;
        return src ? (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="absolute top-0 h-full object-cover"
            style={{ left: i * tileW, width: tileW }}
          />
        ) : null;
      })}
    </div>
  );
}

/**
 * Keyframe diamonds (all properties) along the bottom of a clip. Drag one to
 * move every keyframe at that time; click to put the playhead on it.
 */
function KeyframeMarkers({ clip, pps, locked }: { clip: Clip; pps: number; locked: boolean }) {
  const times = keyframeTimes(clip);
  const [dragging, setDragging] = useState<{ from: number; to: number } | null>(null);
  const dur = clipDuration(clip);
  return (
    <>
      {times.map((t) => {
        const shown = dragging && Math.abs(dragging.from - t) < 1e-3 ? dragging.to : t;
        if (shown < -1e-6 || shown > dur + 1e-6) return null;
        return (
          <div
            key={t}
            role="button"
            aria-label={`Keyframe at ${t.toFixed(2)}s`}
            data-keyframe-time={t.toFixed(3)}
            title={`Keyframe at ${t.toFixed(2)}s (drag to move, click to seek)`}
            className="absolute bottom-[1px] z-[3] h-[9px] w-[9px] -translate-x-1/2 cursor-ew-resize"
            style={{ left: shown * pps }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              const x0 = e.clientX;
              let moved = false;
              let to = t;
              const move = (ev: PointerEvent) => {
                if (!moved && Math.abs(ev.clientX - x0) < 3) return;
                moved = true;
                to = Math.min(dur, Math.max(0, t + (ev.clientX - x0) / pps));
                if (!locked) setDragging({ from: t, to });
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                setDragging(null);
                if (moved && !locked) moveKeyframesAt(clip.id, t, to);
                else if (!moved) {
                  useUiStore.getState().showTimeline();
                  previewEngine.seek(clip.start + t);
                }
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          >
            <div className="h-full w-full rotate-45 border border-black/60 bg-[#ffd43b]" />
          </div>
        );
      })}
    </>
  );
}

/** Audio fade in / out ramps (shaded triangles). */
function FadeRamps({ clip, pps, width, height }: { clip: Clip; pps: number; width: number; height: number }) {
  const fi = Math.min(width, (clip.audio?.fadeIn ?? 0) * pps);
  const fo = Math.min(width, (clip.audio?.fadeOut ?? 0) * pps);
  return (
    <svg className="pointer-events-none absolute inset-0 z-[1]" width={width} height={height} aria-hidden data-fades={`${clip.audio?.fadeIn ?? 0},${clip.audio?.fadeOut ?? 0}`}>
      {fi > 0 && <path d={`M0 0 L${fi} 0 L0 ${height} Z`} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />}
      {fo > 0 && <path d={`M${width} 0 L${width - fo} 0 L${width} ${height} Z`} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />}
    </svg>
  );
}

function ImageTiles({ media, width, height }: { media: MediaItem; width: number; height: number }) {
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const tileW = Math.max(24, height * aspect);
  const count = Math.max(1, Math.min(MAX_TILES, Math.ceil(width / tileW)));
  return (
    <div className="absolute inset-0 overflow-hidden">
      {media.thumbnail &&
        Array.from({ length: count }, (_, i) => (
          <img key={i} src={media.thumbnail} alt="" draggable={false} className="absolute top-0 h-full object-cover" style={{ left: i * tileW, width: tileW }} />
        ))}
    </div>
  );
}

function ClipWaveform({ clip, media }: { clip: Clip; media: MediaItem }) {
  const peaks = media.waveform;
  if (!peaks?.length || !media.duration) return null;
  const n = peaks.length;
  const from = Math.max(0, Math.floor((clip.sourceIn / media.duration) * n));
  const to = Math.min(n, Math.max(from + 1, Math.ceil((clip.sourceOut / media.duration) * n)));
  return (
    <Waveform
      peaks={peaks.slice(from, to)}
      className="absolute inset-x-0 bottom-0 top-3 h-[calc(100%-12px)] w-full fill-[color-mix(in_srgb,var(--color-track-audio)_75%,white)] opacity-80"
    />
  );
}

export const TimelineClip = memo(function TimelineClip({
  clip,
  media,
  trackType,
  height,
  pps,
  selected,
  locked,
  dragging,
  dropTarget,
  onPointerDown,
}: TimelineClipProps) {
  const duration = clipDuration(clip);
  const width = Math.max(2, duration * pps);
  const color = TRACK_COLOR_VAR[trackType === 'text' ? 'text' : media?.kind === 'audio' ? 'audio' : trackType];
  const isText = !!clip.text;
  const missing = !isText && (!media || media.status !== 'ready');
  const graded = !!clip.filter || (clip.effects?.length ?? 0) > 0 || (!!clip.color && Object.values(clip.color).some((v) => Math.abs(v) > 1e-4));
  const innerH = height - 4;
  const showLabel = width > 36;

  return (
    <div
      role="button"
      aria-label={`Clip ${clip.name}`}
      aria-selected={selected}
      data-clip-id={clip.id}
      title={`${clip.name}\n${formatDuration(duration)} · starts ${clip.start.toFixed(2)}s`}
      onPointerDown={(e) => onPointerDown(e, clip.id, 'move')}
      className={cn(
        'group absolute top-[2px] overflow-hidden rounded-[5px] border select-none',
        locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        selected ? 'z-[5] border-white shadow-[0_0_0_1px_white]' : 'border-black/40',
        dragging && 'z-[6] opacity-90 shadow-lg shadow-black/50',
        dropTarget && 'ring-2 ring-accent',
      )}
      style={{
        left: clip.start * pps,
        width,
        height: innerH,
        background: missing ? undefined : `color-mix(in srgb, ${color} 32%, #15161a)`,
      }}
    >
      {isText ? (
        <div className="absolute inset-0 flex items-center gap-1 px-1.5 pt-2.5 text-[10px] text-white/85" dir="auto">
          <Type size={10} className="shrink-0 opacity-70" />
          <span className="truncate">{clip.text!.content.replace(/\n/g, ' ')}</span>
        </div>
      ) : missing || !media ? (
        <div className="absolute inset-0 flex items-center gap-1 bg-danger/15 px-1.5 text-[10px] text-danger [background-image:repeating-linear-gradient(-45deg,rgb(240_82_95/0.15)_0_6px,transparent_6px_12px)]">
          <AlertTriangle size={11} className="shrink-0" />
          {showLabel && <span className="truncate">Media missing</span>}
        </div>
      ) : media.kind === 'video' ? (
        <Filmstrip clip={clip} media={media} width={width} height={innerH} pps={pps} />
      ) : media.kind === 'image' ? (
        <ImageTiles media={media} width={width} height={innerH} />
      ) : (
        <ClipWaveform clip={clip} media={media} />
      )}

      {showLabel && !missing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-1.5 pb-1.5 pt-0.5 text-[10px] leading-none text-white">
          <span className="truncate font-medium">{clip.name}</span>
          <span className="ml-auto shrink-0 font-mono text-white/70">{formatDuration(duration)}</span>
        </div>
      )}
      {(clip.speed !== 1 || clip.reversed || graded) && showLabel && (
        <span className="pointer-events-none absolute bottom-0.5 left-1 flex items-center gap-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
          {clip.speed !== 1 && <span>{clip.speed}×</span>}
          {clip.reversed && <Rewind size={9} aria-label="Reversed" />}
          {graded && <Sparkles size={9} aria-label="Effects or colour applied" />}
        </span>
      )}
      {clip.keyframes && <KeyframeMarkers clip={clip} pps={pps} locked={locked} />}
      {clip.audio && (clip.audio.fadeIn > 0 || clip.audio.fadeOut > 0) && <FadeRamps clip={clip} pps={pps} width={width} height={innerH} />}

      {!locked && (
        <>
          <div
            aria-label="Trim start"
            onPointerDown={(e) => onPointerDown(e, clip.id, 'trim-left')}
            className={cn(
              'absolute inset-y-0 left-0 z-[2] w-[7px] cursor-ew-resize bg-white/0 transition-colors hover:bg-white/80',
              selected && 'bg-white/90',
            )}
          />
          <div
            aria-label="Trim end"
            onPointerDown={(e) => onPointerDown(e, clip.id, 'trim-right')}
            className={cn(
              'absolute inset-y-0 right-0 z-[2] w-[7px] cursor-ew-resize bg-white/0 transition-colors hover:bg-white/80',
              selected && 'bg-white/90',
            )}
          />
        </>
      )}
    </div>
  );
});
