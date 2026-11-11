import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useMediaStore } from '../../store/mediaStore';
import { TRACK_TYPE_LABEL, useProjectStore } from '../../store/projectStore';
import { formatBytes, formatDuration } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { MediaItem, Track } from '../../types';
import { Button } from '../controls/Button';
import { InfoRow, PropertyRow, PropertySection, Switch } from './PropertySection';
import { ProjectProperties } from './ProjectProperties';
import { Waveform } from '../media/MediaItemView';
import { InlineTextInput } from '../controls/InlineTextInput';
import { ClipProperties, MultiClipProperties } from './ClipProperties';
import { TransitionProperties } from './TransitionProperties';
import { SliderRow } from './controls';

function MediaProperties({ item }: { item: MediaItem }) {
  const removeMedia = useMediaStore((s) => s.removeMedia);
  return (
    <>
      <div className="border-b border-line p-3">
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-black">
          {item.kind === 'audio' ? (
            item.waveform ? <Waveform peaks={item.waveform} className="h-1/2 w-11/12 fill-track-audio" /> : <span className="text-fg-subtle">Audio</span>
          ) : item.thumbnail ? (
            <img src={item.thumbnail} alt="" className="h-full w-full object-contain" />
          ) : null}
        </div>
        <div className="mt-2 break-words text-[12px] font-medium">{item.name}</div>
      </div>
      <PropertySection title="File details">
        <InfoRow label="Type" value={item.kind[0].toUpperCase() + item.kind.slice(1)} />
        <InfoRow label="Format" value={item.mimeType || 'Unknown'} />
        <InfoRow label="Size" value={formatBytes(item.size)} />
        {item.width && <InfoRow label="Dimensions" value={`${item.width} × ${item.height}`} />}
        {item.kind !== 'image' && <InfoRow label="Duration" value={formatDuration(item.duration)} />}
        <InfoRow label="Imported" value={new Date(item.importedAt).toLocaleString()} />
        <InfoRow
          label="Status"
          value={
            item.status === 'error' ? (
              <span className="text-danger">{item.error ?? 'Error'}</span>
            ) : item.status === 'processing' ? (
              'Processing…'
            ) : item.persisted ? (
              <span className="text-success">Stored locally</span>
            ) : (
              <span className="text-warning">Session only</span>
            )
          }
        />
      </PropertySection>
      <div className="p-3">
        <Button variant="danger" className="w-full" onClick={() => removeMedia(item.id)}>
          <Trash2 size={13} />
          Remove from project
        </Button>
      </div>
    </>
  );
}

function TrackProperties({ track }: { track: Track }) {
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const toggle = useProjectStore((s) => s.toggleTrackFlag);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const setSelection = useUiStore((s) => s.setSelection);
  const canHide = track.type !== 'audio';
  const canMute = track.type !== 'text';
  const clipCount = useProjectStore((s) => Object.values(s.document.clips).filter((c) => c.trackId === track.id).length);
  const moveTrack = useProjectStore((s) => s.moveTrack);
  const setTrackVolume = useProjectStore((s) => s.setTrackVolume);
  // Tracks reorder within their group (e.g. overlay tracks among themselves).
  const canMoveUp = useProjectStore((s) => {
    const i = s.document.tracks.findIndex((t) => t.id === track.id);
    return i > 0 && s.document.tracks[i - 1].type === track.type;
  });
  const canMoveDown = useProjectStore((s) => {
    const i = s.document.tracks.findIndex((t) => t.id === track.id);
    return i >= 0 && i < s.document.tracks.length - 1 && s.document.tracks[i + 1].type === track.type;
  });

  return (
    <>
      <PropertySection title="Track">
        <PropertyRow label="Name" stacked>
          <InlineTextInput
            key={track.id}
            className="field"
            aria-label="Track name"
            value={track.name}
            maxLength={40}
            onCommit={(name) => renameTrack(track.id, name)}
          />
        </PropertyRow>
        <InfoRow label="Type" value={TRACK_TYPE_LABEL[track.type].replace('Main ', '')} />
        <InfoRow label="Clips" value={clipCount} />
        {track.isMain && <InfoRow label="Role" value="Main track (cannot be deleted)" />}
        {track.type !== 'text' && (
          <SliderRow
            label="Track volume"
            value={track.volume ?? 1}
            min={0}
            max={2}
            step={0.01}
            format={(v) => Math.round(v * 100) + '%'}
            resetTo={1}
            onChange={(v) => setTrackVolume(track.id, v, 'track.' + track.id + '.volume')}
          />
        )}
        {track.type !== 'audio' && (
          <PropertyRow label="Layer order">
            <div className="flex justify-end gap-1">
              <Button className="px-2!" disabled={!canMoveUp} onClick={() => moveTrack(track.id, -1)} aria-label="Move track up" title="Move up (renders above)">
                <ArrowUp size={13} />
              </Button>
              <Button className="px-2!" disabled={!canMoveDown} onClick={() => moveTrack(track.id, 1)} aria-label="Move track down" title="Move down (renders below)">
                <ArrowDown size={13} />
              </Button>
            </div>
          </PropertyRow>
        )}
      </PropertySection>
      <PropertySection title="State">
        {canHide && (
          <PropertyRow label="Visible">
            <div className="flex justify-end">
              <Switch label="Visible" checked={!track.hidden} onChange={() => toggle(track.id, 'hidden')} />
            </div>
          </PropertyRow>
        )}
        {canMute && (
          <PropertyRow label="Audio enabled">
            <div className="flex justify-end">
              <Switch label="Audio enabled" checked={!track.muted} onChange={() => toggle(track.id, 'muted')} />
            </div>
          </PropertyRow>
        )}
        <PropertyRow label="Locked">
          <div className="flex justify-end">
            <Switch label="Locked" checked={track.locked} onChange={() => toggle(track.id, 'locked')} />
          </div>
        </PropertyRow>
      </PropertySection>
      {!track.isMain && (
        <div className="p-3">
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              removeTrack(track.id);
              setSelection({ kind: 'none' });
            }}
          >
            <Trash2 size={13} />
            Delete track
          </Button>
        </div>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection);
  const media = useMediaStore((s) => (selection.kind === 'media' ? s.items.find((m) => m.id === selection.id) : undefined));
  const track = useProjectStore((s) => (selection.kind === 'track' ? s.document.tracks.find((t) => t.id === selection.id) : undefined));
  // Selections can reference clips removed by undo – count only live ones.
  const clipCount = useProjectStore((s) => (selection.kind === 'clips' ? selection.ids.filter((id) => s.document.clips[id]).length : 0));
  const singleClip = useProjectStore((s) =>
    selection.kind === 'clips' && clipCount === 1 ? s.document.clips[selection.ids.find((id) => s.document.clips[id])!] : undefined,
  );
  const transition = useProjectStore((s) => (selection.kind === 'transition' ? s.document.transitions?.[selection.id] : undefined));
  const contextual = media ? 'Media' : track ? 'Track' : clipCount === 1 ? 'Clip' : clipCount > 1 ? 'Clips' : transition ? 'Transition' : null;
  const [tab, setTab] = useState<'project' | 'context'>('project');

  // Jump to the contextual tab whenever a new item is selected.
  const selKey =
    selection.kind === 'none' ? 'none' : selection.kind === 'clips' ? `clips:${selection.ids.join(',')}` : `${selection.kind}:${selection.id}`;
  useEffect(() => setTab(selKey === 'none' ? 'project' : 'context'), [selKey]);
  // "Show Properties" (context menu): always land on the selected item.
  const focus = useUiStore((s) => s.propertiesFocus);
  useEffect(() => {
    if (focus) setTab('context');
  }, [focus]);

  const activeTab = contextual ? tab : 'project';

  return (
    <aside aria-label="Properties" className="flex h-full w-[280px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-9 shrink-0 items-end gap-4 border-b border-line px-3" role="tablist">
        {[
          { id: 'project' as const, label: 'Project' },
          ...(contextual ? [{ id: 'context' as const, label: contextual }] : []),
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px h-full border-b-2 text-[12px] font-medium transition-colors',
              activeTab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'project' && <ProjectProperties />}
        {activeTab === 'context' && media && <MediaProperties item={media} />}
        {activeTab === 'context' && track && <TrackProperties track={track} />}
        {activeTab === 'context' && singleClip && <ClipProperties clip={singleClip} />}
        {activeTab === 'context' && clipCount > 1 && <MultiClipProperties count={clipCount} />}
        {activeTab === 'context' && transition && <TransitionProperties transition={transition} />}
      </div>
    </aside>
  );
}
