import { BringToFront, CopyPlus, Scissors, SendToBack, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { canSplitAt, clipDuration, clipEnd, clipsOnTrack, quantizeToFrame, resolvePlacement } from '../../engine/timelineModel';
import { deleteSelection, duplicateSelection, splitSelectedAtPlayhead } from '../../services/editingService';
import { moveClipLayer } from '../../services/advancedEditing';
import { formatBytes, formatTimecode } from '../../utils/format';
import type { Clip } from '../../types';
import { Button } from '../controls/Button';
import { InlineTextInput } from '../controls/InlineTextInput';
import { InfoRow, PropertyRow, PropertySection } from './PropertySection';
import { SecondsField } from './controls';
import { AudioSection } from './AudioSection';
import { lazy, Suspense } from 'react';

const BackgroundSection = lazy(() => import('../ai/BackgroundSection').then((m) => ({ default: m.BackgroundSection })));
import { AnimationSection, ColorSection, EffectsSection, KeyframesSection, SpeedSection, TextSection, TransformSection } from './AdvancedSections';

export function ClipProperties({ clip }: { clip: Clip }) {
  const media = useMediaStore((s) => s.items.find((m) => m.id === clip.mediaId));
  const track = useProjectStore((s) => s.document.tracks.find((t) => t.id === clip.trackId));
  const fps = useProjectStore((s) => s.document.canvas.frameRate);
  const updateClip = useProjectStore((s) => s.updateClip);
  const moveClips = useProjectStore((s) => s.moveClips);
  // Boolean selector: re-render only when split availability flips, not every frame.
  const canSplit = usePlaybackStore((s) => canSplitAt(clip, quantizeToFrame(s.timelineTime, fps)));

  const locked = !!track?.locked;
  const isText = !!clip.text;
  const visual = isText || (!!media && media.kind !== 'audio');
  const hasAudio = media?.kind === 'video' || media?.kind === 'audio';
  const timed = media?.kind === 'video' || media?.kind === 'audio';
  const duration = clipDuration(clip);

  const setStart = (start: number) => {
    const doc = useProjectStore.getState().document;
    const others = clipsOnTrack(doc, clip.trackId).filter((c) => c.id !== clip.id);
    moveClips([{ id: clip.id, start: resolvePlacement(others, start, duration), trackId: clip.trackId }]);
  };

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line p-3">
        <Button className="flex-1 px-2!" disabled={locked || !canSplit} onClick={splitSelectedAtPlayhead} title="Split at playhead (S)">
          <Scissors size={13} /> Split
        </Button>
        <Button className="flex-1 px-2!" disabled={locked} onClick={duplicateSelection} title="Duplicate (Ctrl+D)">
          <CopyPlus size={13} /> Duplicate
        </Button>
        {visual && !isText && (
          <>
            <Button className="px-2!" disabled={locked} onClick={() => moveClipLayer(clip.id, -1)} aria-label="Bring forward" title="Bring forward (layer above)">
              <BringToFront size={13} />
            </Button>
            <Button className="px-2!" disabled={locked} onClick={() => moveClipLayer(clip.id, 1)} aria-label="Send backward" title="Send backward (layer below)">
              <SendToBack size={13} />
            </Button>
          </>
        )}
        <Button variant="danger" className="px-2!" disabled={locked} onClick={deleteSelection} aria-label="Delete clip" title="Delete (Del)">
          <Trash2 size={13} />
        </Button>
      </div>
      {locked && <p className="border-b border-line px-3 py-2 text-[11px] text-warning">This clip's track is locked.</p>}

      <PropertySection title="Clip">
        <PropertyRow label="Name" stacked>
          <InlineTextInput
            key={clip.id}
            className="field"
            aria-label="Clip name"
            value={clip.name}
            maxLength={80}
            disabled={locked}
            onCommit={(name) => updateClip(clip.id, { name })}
          />
        </PropertyRow>
        <PropertyRow label="Start (s)">
          <SecondsField label="Clip start" value={clip.start} onCommit={setStart} disabled={locked} />
        </PropertyRow>
        <InfoRow label="Duration" value={<span className="font-mono">{formatTimecode(duration, fps)}</span>} />
        <InfoRow label="Timeline" value={<span className="font-mono">{formatTimecode(clip.start, fps)} → {formatTimecode(clipEnd(clip), fps)}</span>} />
        {timed && (
          <InfoRow
            label="Source range"
            value={
              <span className="font-mono">
                {clip.sourceIn.toFixed(2)}s → {clip.sourceOut.toFixed(2)}s{clip.reversed ? ' (reversed)' : ''}
              </span>
            }
          />
        )}
      </PropertySection>

      {isText && <TextSection key={clip.id} clip={clip} locked={locked} />}
      {visual && <TransformSection clip={clip} locked={locked} isText={isText} />}
      {visual && <AnimationSection clip={clip} locked={locked} isText={isText} />}
      {timed && <SpeedSection clip={clip} locked={locked} canReverse={media?.kind === 'video'} />}

      {hasAudio && <AudioSection clip={clip} track={track} locked={locked} isVideo={media?.kind === 'video'} />}

      {visual && !isText && (media?.kind === 'video' || media?.kind === 'image') && (
        <Suspense fallback={null}>
          <BackgroundSection clip={clip} locked={locked} />
        </Suspense>
      )}
      {visual && <ColorSection clip={clip} locked={locked} />}
      {visual && <EffectsSection clip={clip} locked={locked} />}
      <KeyframesSection clip={clip} locked={locked} />

      {!isText && (
        <PropertySection title="Source media">
          {media ? (
            <>
              <InfoRow label="File" value={media.name} />
              <InfoRow label="Type" value={media.kind[0].toUpperCase() + media.kind.slice(1)} />
              {media.width && <InfoRow label="Dimensions" value={`${media.width} × ${media.height}`} />}
              {media.duration !== undefined && <InfoRow label="Length" value={`${media.duration.toFixed(2)}s`} />}
              <InfoRow label="Size" value={formatBytes(media.size)} />
            </>
          ) : (
            <p className="text-[11px] text-danger">The source media for this clip is missing.</p>
          )}
        </PropertySection>
      )}
    </>
  );
}

export function MultiClipProperties({ count }: { count: number }) {
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12px]">{count} clips selected</p>
      <div className="flex gap-1.5">
        <Button className="flex-1" onClick={duplicateSelection}>
          <CopyPlus size={13} /> Duplicate
        </Button>
        <Button variant="danger" className="flex-1" onClick={deleteSelection}>
          <Trash2 size={13} /> Delete
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-fg-subtle">
        Drag any selected clip to move them together. Ctrl/Shift+click toggles selection. Effects and filters from the libraries apply to every selected clip.
      </p>
    </div>
  );
}
