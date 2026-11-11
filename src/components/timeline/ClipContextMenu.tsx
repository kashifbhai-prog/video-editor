import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Gauge,
  Layers,
  ListChecks,
  Lock,
  PanelRight,
  Pencil,
  Scissors,
  ScissorsLineDashed,
  SquareDashedMousePointer,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  Clapperboard,
  Music2,
  Image as ImageIcon,
  Type,
  AudioLines,
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { clipDuration, clipEnd, quantizeToFrame } from '../../engine/timelineModel';
import { clipAudio } from '../../engine/audio';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  getSelectedClipIds,
  pasteClipboard,
  selectAllClips,
  selectClips,
  splitSelectedAtPlayhead,
  trimSelectedToPlayhead,
} from '../../services/editingService';
import { moveClipLayer, setSpeed } from '../../services/advancedEditing';
import { extractAudio } from '../../services/audioEditing';
import { useMediaInfo } from '../../services/mediaInfo';
import { usePlaybackStore } from '../../store/playbackStore';
import { formatTimecode } from '../../utils/format';
import type { Clip, MediaItem, Track } from '../../types';
import { ContextMenu, placeInViewport, type MenuEntry } from '../controls/ContextMenu';

// ---------------------------------------------------------------------------
// Right-click menu for timeline items. The item under the pointer is selected
// first (an existing multi-selection that contains it is kept), then the menu
// shows the item's real properties and the actions that apply. Every action
// runs the editor's existing commands (same as toolbar / shortcuts).
// ---------------------------------------------------------------------------

type MenuTarget = { x: number; y: number } & ({ kind: 'clip'; clipId: string } | { kind: 'lane'; trackId: string });

interface MenuState {
  menu: MenuTarget | null;
  rename: { x: number; y: number; clipId: string } | null;
}
export const useTimelineMenu = create<MenuState>()(() => ({ menu: null, rename: null }));

/** Right-click on a clip: select it (unless it is part of the current selection) and open the menu. */
export function openClipMenu(e: React.MouseEvent, clipId: string) {
  e.preventDefault();
  e.stopPropagation();
  if (!getSelectedClipIds().includes(clipId)) selectClips([clipId]);
  useTimelineMenu.setState({ menu: { kind: 'clip', clipId, x: e.clientX, y: e.clientY }, rename: null });
}

/** Right-click on an empty part of a track lane. */
export function openLaneMenu(e: React.MouseEvent, trackId: string) {
  e.preventDefault();
  useTimelineMenu.setState({ menu: { kind: 'lane', trackId, x: e.clientX, y: e.clientY }, rename: null });
}

const closeMenu = () => useTimelineMenu.setState({ menu: null });

// ---- Property read-outs -------------------------------------------------------------------

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(2)} s`;
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="truncate text-fg-subtle">{label}</span>
      <span className="truncate text-right font-mono text-fg" data-prop={label}>
        {children}
      </span>
    </>
  );
}

const KIND_ICON = { video: Clapperboard, audio: Music2, image: ImageIcon, text: Type } as const;

function ItemProperties({ clip, media, track, fps }: { clip: Clip; media: MediaItem | undefined; track: Track | undefined; fps: number }) {
  const kind: keyof typeof KIND_ICON = clip.text ? 'text' : (media?.kind ?? 'video');
  const info = useMediaInfo(clip.text ? undefined : media);
  const loading = info === undefined ? '…' : undefined;
  const dur = clipDuration(clip);
  const tc = (t: number) => formatTimecode(t, fps);
  const a = clipAudio(clip);
  const Icon = KIND_ICON[kind];
  const label = { video: 'Video clip', audio: 'Audio clip', image: 'Image', text: 'Text' }[kind];
  const pos = `${Math.round(clip.transform.x * 100)}%, ${Math.round(clip.transform.y * 100)}%`;
  return (
    <div className="mx-1 mb-1 rounded-md bg-panel-3/60 px-2.5 py-2" data-testid="context-properties" data-kind={kind}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={13} className="shrink-0 text-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</span>
        <span className="ml-auto max-w-[60%] truncate text-right text-[12px] font-medium" dir="auto" title={clip.name}>
          {clip.text ? clip.text.content.replace(/\n/g, ' ') : clip.name}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[11px]">
        {kind === 'audio' && (
          <>
            <Row label="Duration">{tc(dur)}</Row>
            <Row label="Start">{tc(clip.start)}</Row>
            <Row label="End">{tc(clipEnd(clip))}</Row>
            <Row label="Volume">{pct(clip.volume)}</Row>
            <Row label="Speed">{`${clip.speed}×`}</Row>
            <Row label="Channels">{loading ?? (info?.channels ? (info.channels === 1 ? '1 (mono)' : info.channels === 2 ? '2 (stereo)' : String(info.channels)) : '—')}</Row>
            <Row label="Sample rate">{loading ?? (info?.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '—')}</Row>
            <Row label="Muted">{track?.muted ? 'Yes (track)' : clip.volume === 0 ? 'Yes (volume 0)' : 'No'}</Row>
            <Row label="Fade in / out">{a.fadeIn || a.fadeOut ? `${secs(a.fadeIn)} / ${secs(a.fadeOut)}` : 'None'}</Row>
          </>
        )}
        {kind === 'image' && (
          <>
            <Row label="Size">{media?.width && media.height ? `${media.width}×${media.height}` : '—'}</Row>
            <Row label="Duration">{tc(dur)}</Row>
            <Row label="Start">{tc(clip.start)}</Row>
            <Row label="Position">{pos}</Row>
            <Row label="Scale">{pct(clip.transform.scale)}</Row>
            <Row label="Rotation">{`${Math.round(clip.transform.rotation ?? 0)}°`}</Row>
            <Row label="Opacity">{pct(clip.opacity)}</Row>
          </>
        )}
        {kind === 'text' && clip.text && (
          <>
            <Row label="Font">{clip.text.style.fontFamily}</Row>
            <Row label="Size">{`${clip.text.style.fontSize}px`}</Row>
            <Row label="Colour">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-white/30" style={{ background: clip.text.style.color }} />
                {clip.text.style.color}
              </span>
            </Row>
            <Row label="Position">{pos}</Row>
            <Row label="Duration">{tc(dur)}</Row>
            <Row label="Start">{tc(clip.start)}</Row>
            <Row label="Alignment">{clip.text.style.align}</Row>
          </>
        )}
      </div>
    </div>
  );
}

function SelectionSummary({ clips }: { clips: Clip[] }) {
  const start = Math.min(...clips.map((c) => c.start));
  const end = Math.max(...clips.map(clipEnd));
  return (
    <div className="mx-1 mb-1 rounded-md bg-panel-3/60 px-2.5 py-2 text-[11px]" data-testid="context-properties" data-kind="multiple">
      <div className="mb-1 flex items-center gap-1.5">
        <ListChecks size={13} className="text-accent" />
        <span className="font-medium">{clips.length} clips selected</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        <Row label="Span">{`${secs(start)} → ${secs(end)}`}</Row>
        <Row label="Total length">{secs(clips.reduce((s, c) => s + clipDuration(c), 0))}</Row>
      </div>
    </div>
  );
}

// ---- Menu contents ---------------------------------------------------------------------------

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const NO_IDS: string[] = [];

function useClipMenuItems(target: Extract<MenuTarget, { kind: 'clip' }>): { header: ReactNode; items: MenuEntry[] } {
  const doc = useProjectStore((s) => s.document);
  const media = useMediaStore((s) => s.items);
  const clipboard = useUiStore((s) => s.clipboard);
  const selIds = useUiStore((s) => (s.selection.kind === 'clips' ? s.selection.ids : NO_IDS));
  const t = usePlaybackStore((s) => s.timelineTime);
  const fps = doc.canvas.frameRate;
  const clips = selIds.map((id) => doc.clips[id]).filter(Boolean);
  const clip = doc.clips[target.clipId];
  const clipMedia = clip && !clip.text ? media.find((m) => m.id === clip.mediaId) : undefined;
  const videoInfo = useMediaInfo(clipMedia?.kind === 'video' ? clipMedia : undefined);
  if (!clip) return { header: null, items: [] };
  const sel = clips.length ? clips : [clip];
  const single = sel.length === 1;
  const mediaOf = (c: Clip) => media.find((m) => m.id === c.mediaId);
  const trackOf = (c: Clip) => doc.tracks.find((tr) => tr.id === c.trackId);
  const track = trackOf(clip);
  const tracks = [...new Set(sel.map((c) => c.trackId))].map((id) => doc.tracks.find((tr) => tr.id === id)!).filter(Boolean);
  const allLocked = tracks.every((tr) => tr.locked);
  const editable = sel.some((c) => !trackOf(c)?.locked);
  const lockedHint = 'The track is locked';
  const tq = quantizeToFrame(t, fps);
  const underPlayhead = sel.some((c) => tq > c.start + 1e-6 && tq < clipEnd(c) - 1e-6);
  const playheadHint = 'Move the playhead inside the clip';
  const audioTracks = tracks.filter((tr) => tr.type !== 'text' && sel.some((c) => c.trackId === tr.id && (mediaOf(c)?.kind === 'audio' || mediaOf(c)?.kind === 'video')));
  const allMuted = audioTracks.length > 0 && audioTracks.every((tr) => tr.muted);
  const timed = sel.filter((c) => !c.text && mediaOf(c)?.kind !== 'image');
  const visual = single && !clip.text && mediaOf(clip)?.kind !== 'audio';
  const P = useProjectStore.getState;

  const items: MenuEntry[] = [
    { id: 'cut', label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X', disabled: !editable, hint: lockedHint, onSelect: cutSelection },
    { id: 'copy', label: 'Copy', icon: Copy, shortcut: 'Ctrl+C', onSelect: copySelection },
    { id: 'paste', label: 'Paste at playhead', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !clipboard.length, hint: 'Nothing copied yet', onSelect: pasteClipboard },
    { id: 'duplicate', label: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl+D', disabled: !editable, hint: lockedHint, onSelect: duplicateSelection },
    { id: 'delete', label: single ? 'Delete' : `Delete ${sel.length} clips`, icon: Trash2, shortcut: 'Del', danger: true, disabled: !editable, hint: lockedHint, onSelect: deleteSelection },
    { kind: 'separator', id: 's1' },
    { id: 'split', label: 'Split at playhead', icon: ScissorsLineDashed, shortcut: 'S', disabled: !editable || !underPlayhead, hint: !editable ? lockedHint : playheadHint, onSelect: splitSelectedAtPlayhead },
    { id: 'trim-start', label: 'Trim start to playhead', icon: BetweenHorizontalStart, shortcut: 'Q', disabled: !editable || !underPlayhead, hint: !editable ? lockedHint : playheadHint, onSelect: () => trimSelectedToPlayhead('start') },
    { id: 'trim-end', label: 'Trim end to playhead', icon: BetweenHorizontalEnd, shortcut: 'W', disabled: !editable || !underPlayhead, hint: !editable ? lockedHint : playheadHint, onSelect: () => trimSelectedToPlayhead('end') },
  ];
  // Video clip: move its sound to its own audio clip (same command as Properties → Audio).
  if (single && clipMedia?.kind === 'video') {
    const noAudio = videoInfo !== undefined && !videoInfo?.hasAudio;
    items.push({
      id: 'extract-audio',
      label: 'Extract audio',
      icon: AudioLines,
      disabled: !editable || noAudio,
      hint: !editable ? lockedHint : 'This video has no audio track',
      onSelect: () => void extractAudio(clip.id),
    });
  }
  if (timed.length) {
    items.push({
      kind: 'submenu',
      id: 'speed',
      label: 'Speed',
      icon: Gauge,
      disabled: !editable,
      items: SPEEDS.map((v) => ({ id: `speed-${v}`, label: `${v}×${v === 1 ? ' (normal)' : ''}`, checked: timed.every((c) => c.speed === v), onSelect: () => P().transaction(() => timed.forEach((c) => setSpeed(c.id, v))) })),
    });
  }
  if (visual) {
    items.push({
      kind: 'submenu',
      id: 'arrange',
      label: 'Arrange',
      icon: Layers,
      disabled: !editable,
      items: [
        { id: 'forward', label: 'Bring forward', icon: ArrowUpToLine, onSelect: () => moveClipLayer(clip.id, 1) },
        { id: 'backward', label: 'Send backward', icon: ArrowDownToLine, onSelect: () => moveClipLayer(clip.id, -1) },
      ],
    });
  }
  items.push({ kind: 'separator', id: 's2' });
  items.push({
    id: 'rename',
    label: 'Rename…',
    icon: Pencil,
    disabled: !single || !editable,
    hint: !single ? 'Select a single clip' : lockedHint,
    onSelect: () => useTimelineMenu.setState({ rename: { x: target.x, y: target.y, clipId: clip.id } }),
  });
  items.push({
    id: 'lock',
    label: allLocked ? `Unlock track${tracks.length > 1 ? 's' : ` (${tracks[0]?.name})`}` : `Lock track${tracks.length > 1 ? 's' : ` (${tracks[0]?.name})`}`,
    icon: allLocked ? Unlock : Lock,
    onSelect: () => P().transaction(() => tracks.forEach((tr) => tr.locked === allLocked && P().toggleTrackFlag(tr.id, 'locked'))),
  });
  if (audioTracks.length) {
    items.push({
      id: 'mute',
      label: allMuted ? `Unmute track${audioTracks.length > 1 ? 's' : ` (${audioTracks[0].name})`}` : `Mute track${audioTracks.length > 1 ? 's' : ` (${audioTracks[0].name})`}`,
      icon: allMuted ? Volume2 : VolumeX,
      onSelect: () => P().transaction(() => audioTracks.forEach((tr) => tr.muted === allMuted && P().toggleTrackFlag(tr.id, 'muted'))),
    });
  }
  items.push({ kind: 'separator', id: 's3' });
  items.push({
    id: 'properties',
    label: 'Show properties',
    icon: PanelRight,
    disabled: !single,
    hint: 'Select a single clip',
    onSelect: () => {
      selectClips([clip.id]);
      useUiStore.getState().focusProperties();
    },
  });
  items.push({ id: 'select-all', label: 'Select all', icon: SquareDashedMousePointer, shortcut: 'Ctrl+A', onSelect: selectAllClips });

  // Video clips show no properties card (actions only); other types keep theirs.
  const header = !single ? <SelectionSummary clips={sel} /> : clipMedia?.kind === 'video' ? null : <ItemProperties clip={clip} media={mediaOf(clip)} track={track} fps={fps} />;
  return { header, items };
}

function ClipMenu({ target }: { target: Extract<MenuTarget, { kind: 'clip' }> }) {
  const { header, items } = useClipMenuItems(target);
  if (!items.length) return null;
  return <ContextMenu x={target.x} y={target.y} header={header} items={items} onClose={closeMenu} label="Clip actions" />;
}

function LaneMenu({ target }: { target: Extract<MenuTarget, { kind: 'lane' }> }) {
  const clipboard = useUiStore((s) => s.clipboard);
  const hasClips = useProjectStore((s) => Object.keys(s.document.clips).length > 0);
  const items: MenuEntry[] = [
    { id: 'paste', label: 'Paste at playhead', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !clipboard.length, hint: 'Nothing copied yet', onSelect: pasteClipboard },
    { id: 'select-all', label: 'Select all', icon: SquareDashedMousePointer, shortcut: 'Ctrl+A', disabled: !hasClips, hint: 'The timeline is empty', onSelect: selectAllClips },
  ];
  return <ContextMenu x={target.x} y={target.y} items={items} onClose={closeMenu} label="Timeline actions" />;
}

/** Inline rename field opened from the menu (Enter saves, Escape cancels). */
function RenamePopover({ x, y, clipId }: { x: number; y: number; clipId: string }) {
  const clip = useProjectStore((s) => s.document.clips[clipId]);
  const [value, setValue] = useState(clip?.name ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useCallback(() => useTimelineMenu.setState({ rename: null }), []);
  const commit = () => {
    const name = value.trim().slice(0, 80);
    if (name && clip && name !== clip.name) useProjectStore.getState().updateClip(clipId, { name });
    close();
  };
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos(placeInViewport(x, y, r.width, r.height));
  }, [x, y]);
  // Focus once visible (typing must never reach the editor's single-key shortcuts).
  useEffect(() => {
    if (!pos) return;
    input.current?.focus();
    input.current?.select();
  }, [pos]);
  useEffect(() => {
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [close]);
  if (!clip) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Rename clip"
      className="ctx-menu-anim fixed z-[1000] w-[260px] rounded-lg border border-line-strong bg-panel-2 p-2 shadow-2xl shadow-black/60"
      style={pos ?? { left: x, top: y, visibility: 'hidden' }}
    >
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Rename clip</label>
      <input
        ref={input}
        aria-label="Clip name"
        className="field w-full"
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') close();
        }}
      />
      <p className="mt-1 text-[10px] text-fg-subtle">Enter to save · Esc to cancel</p>
    </div>
  );
}

/** Mounted once by the timeline. */
export function TimelineContextMenus() {
  const menu = useTimelineMenu((s) => s.menu);
  const rename = useTimelineMenu((s) => s.rename);
  // The menu describes the clip at the time it opened; if the clip disappears (undo, delete) close it.
  const exists = useProjectStore((s) => !menu || menu.kind !== 'clip' || !!s.document.clips[menu.clipId]);
  useEffect(() => {
    if (!exists) closeMenu();
  }, [exists]);
  return (
    <>
      {menu?.kind === 'clip' && exists && <ClipMenu key={`${menu.clipId}@${menu.x},${menu.y}`} target={menu} />}
      {menu?.kind === 'lane' && <LaneMenu key={`${menu.trackId}@${menu.x},${menu.y}`} target={menu} />}
      {rename && <RenamePopover key={rename.clipId} {...rename} />}
    </>
  );
}
