import { memo } from 'react';
import { AlertCircle, Film, Image as ImageIcon, Loader2, Music, Plus, Trash2, HardDriveDownload } from 'lucide-react';
import type { MediaItem, MediaKind } from '../../types';
import { addMediaToTimeline } from '../../services/editingService';
import { MEDIA_DRAG_MIME, setDraggedMedia } from '../timeline/dragStore';
import { formatBytes, formatDuration } from '../../utils/format';
import { cn } from '../../utils/cn';
import { Tooltip } from '../controls/Tooltip';

export const KIND_ICON: Record<MediaKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music };

/** Reduces peaks to at most `max` bars (keeping the loudest value of each group). */
function downsample(peaks: number[], max: number): number[] {
  if (peaks.length <= max) return peaks;
  const out: number[] = [];
  const step = peaks.length / max;
  for (let i = 0; i < max; i++) {
    let m = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) m = Math.max(m, peaks[j]);
    out.push(m);
  }
  return out;
}

export function Waveform({ peaks, className, maxBars = 160 }: { peaks: number[]; className?: string; maxBars?: number }) {
  const bars = downsample(peaks, maxBars);
  const n = bars.length;
  return (
    <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className={className} aria-hidden>
      {bars.map((p, i) => {
        const h = Math.max(4, p * 90);
        return <rect key={i} x={i + 0.15} y={50 - h / 2} width={0.7} height={h} rx={0.3} />;
      })}
    </svg>
  );
}

function Thumb({ item, className }: { item: MediaItem; className?: string }) {
  const Icon = KIND_ICON[item.kind];
  if (item.status === 'processing') {
    return (
      <div className={cn('flex items-center justify-center bg-panel-3', className)}>
        <Loader2 size={16} className="animate-spin text-fg-subtle" />
      </div>
    );
  }
  if (item.status === 'error') {
    return (
      <div className={cn('flex items-center justify-center bg-danger/10', className)}>
        <AlertCircle size={16} className="text-danger" />
      </div>
    );
  }
  if (item.kind === 'audio') {
    return (
      <div className={cn('flex items-center justify-center bg-[#173a35] px-2', className)}>
        {item.waveform ? (
          <Waveform peaks={item.waveform} className="h-3/5 w-full fill-track-audio" />
        ) : (
          <Music size={18} className="text-track-audio" />
        )}
      </div>
    );
  }
  if (item.thumbnail) {
    return (
      <div className={cn('bg-black', className)}>
        <img src={item.thumbnail} alt="" draggable={false} className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className={cn('flex items-center justify-center bg-panel-3', className)}>
      <Icon size={18} className="text-fg-subtle" />
    </div>
  );
}

interface MediaItemViewProps {
  item: MediaItem;
  mode: 'grid' | 'list';
  selected: boolean;
  previewing: boolean;
  onSelect: (item: MediaItem) => void;
  onRemove: (item: MediaItem) => void;
}

export const MediaItemView = memo(function MediaItemView({
  item,
  mode,
  selected,
  previewing,
  onSelect,
  onRemove,
}: MediaItemViewProps) {
  const Icon = KIND_ICON[item.kind];
  const meta =
    item.status === 'error'
      ? 'Unsupported'
      : item.kind === 'image'
        ? item.width
          ? `${item.width}×${item.height}`
          : 'Image'
        : formatDuration(item.duration);

  const removeBtn = (
    <Tooltip label="Remove from project">
      <button
        type="button"
        aria-label={`Remove ${item.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item);
        }}
        className="rounded bg-black/60 p-1 text-fg-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={12} />
      </button>
    </Tooltip>
  );

  const ready = item.status === 'ready';
  const addBtn = ready && (
    <Tooltip label="Add to timeline">
      <button
        type="button"
        aria-label={`Add ${item.name} to timeline`}
        onClick={(e) => {
          e.stopPropagation();
          addMediaToTimeline(item.id);
        }}
        className="rounded bg-accent p-1 text-white opacity-0 transition-opacity hover:bg-accent-hover group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </Tooltip>
  );

  // Library items can be dragged onto timeline tracks.
  const dragProps = ready
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(MEDIA_DRAG_MIME, item.id);
          e.dataTransfer.effectAllowed = 'copy';
          setDraggedMedia(item);
        },
        onDragEnd: () => setDraggedMedia(null),
      }
    : {};

  const title = `${item.name}\n${item.kind.toUpperCase()} · ${formatBytes(item.size)}${item.error ? `\n${item.error}` : ''}${ready ? '\nDrag onto the timeline or click + to add' : ''}`;

  if (mode === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        title={title}
        aria-selected={selected}
        onClick={() => onSelect(item)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(item)}
        {...dragProps}
        className={cn(
          'group flex h-11 cursor-pointer items-center gap-2.5 rounded-md px-1.5 transition-colors',
          selected ? 'bg-accent-soft' : 'hover:bg-hover',
        )}
      >
        <Thumb item={item} className="h-8 w-12 shrink-0 overflow-hidden rounded" />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-[12px]', previewing ? 'text-accent' : 'text-fg')}>{item.name}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <Icon size={10} />
            <span>{meta}</span>
            <span>·</span>
            <span>{formatBytes(item.size)}</span>
            {!item.persisted && item.status === 'ready' && (
              <Tooltip label="Not stored locally – won't be restored after reload">
                <HardDriveDownload size={10} className="text-warning" />
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {addBtn}
          {removeBtn}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      aria-selected={selected}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(item)}
      {...dragProps}
      className="group w-[108px] cursor-pointer"
    >
      <div
        className={cn(
          // Fixed 108×72 thumbnails (video, image and audio alike).
          'relative h-[72px] w-[108px] overflow-hidden rounded-md ring-1 transition-shadow',
          selected ? 'ring-2 ring-accent' : 'ring-line group-hover:ring-line-strong',
        )}
      >
        <Thumb item={item} className="h-full w-full" />
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px font-mono text-[10px] text-white/90">
          {meta}
        </span>
        <span className="absolute bottom-1 left-1 rounded bg-black/60 p-0.5 text-white/80">
          <Icon size={10} />
        </span>
        <div className="absolute right-1 top-1 flex gap-1">
          {addBtn}
          {removeBtn}
        </div>
        {previewing && <span className="absolute left-1 top-1 rounded bg-accent px-1 text-[9px] font-semibold text-white">PREVIEW</span>}
      </div>
      <div className={cn('mt-1 truncate px-0.5 text-[11px]', previewing ? 'text-accent' : 'text-fg-muted')}>{item.name}</div>
    </div>
  );
});
