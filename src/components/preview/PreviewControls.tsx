import { Maximize, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { usePlaybackStore } from '../../store/playbackStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { previewEngine } from '../../engine/previewEngine';
import { ASPECT_RATIOS } from '../../utils/canvas';
import { formatTimecode } from '../../utils/format';
import { togglePreviewFullscreen } from '../../utils/fullscreen';
import type { PreviewQuality } from '../../types';
import { IconButton } from '../controls/IconButton';
import { Select } from '../controls/Select';
import { Tooltip } from '../controls/Tooltip';

const QUALITY_OPTIONS: { value: PreviewQuality; label: string }[] = [
  { value: 'full', label: 'Full quality' },
  { value: 'half', label: '1/2 quality' },
  { value: 'quarter', label: '1/4 quality' },
];

function Scrubber() {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const duration = usePlaybackStore((s) => s.duration);
  const playable = usePlaybackStore((s) => s.playable);
  const pct = duration ? (currentTime / duration) * 100 : 0;
  return (
    <input
      type="range"
      aria-label="Seek"
      min={0}
      max={duration || 1}
      step={0.01}
      value={currentTime}
      disabled={!playable}
      onChange={(e) => previewEngine.seek(Number(e.target.value))}
      className="range block w-full disabled:opacity-30"
      style={{ ['--fill' as string]: `${pct}%` }}
    />
  );
}

function VolumeControl() {
  const volume = usePlaybackStore((s) => s.volume);
  const muted = usePlaybackStore((s) => s.muted);
  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1.5">
      <IconButton icon={Icon} label={muted ? 'Unmute' : 'Mute'} shortcut="M" tooltipSide="top" onClick={() => previewEngine.setMuted(!muted)} />
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(e) => previewEngine.setVolume(Number(e.target.value))}
        className="range w-16"
        style={{ ['--fill' as string]: `${effective * 100}%` }}
      />
    </div>
  );
}

/** Isolated so only the time text re-renders on every frame. */
function CurrentTime({ fps }: { fps: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  return <span className="text-accent">{formatTimecode(currentTime, fps)}</span>;
}

export function PreviewControls() {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const duration = usePlaybackStore((s) => s.duration);
  const playable = usePlaybackStore((s) => s.playable);
  const fps = useProjectStore((s) => s.document.canvas.frameRate);
  const aspect = useProjectStore((s) => s.document.canvas.aspectRatio);
  const setAspect = useProjectStore((s) => s.setAspectRatio);
  const quality = useUiStore((s) => s.previewQuality);
  const setQuality = useUiStore((s) => s.setPreviewQuality);

  return (
    <div className="shrink-0 border-t border-line bg-panel px-3 pb-1.5 pt-2">
      <Scrubber />
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-1 font-mono text-[11px] tabular-nums">
          <CurrentTime fps={fps} />
          <span className="text-fg-subtle">/</span>
          <span className="text-fg-muted">{formatTimecode(duration, fps)}</span>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton icon={SkipBack} label="Go to start" shortcut="Home" tooltipSide="top" disabled={!playable} onClick={() => previewEngine.seek(0)} />
          <IconButton icon={StepBack} label="Previous frame" shortcut="←" tooltipSide="top" disabled={!playable} onClick={() => previewEngine.step(-1, fps)} />
          <Tooltip label={isPlaying ? 'Pause' : 'Play'} shortcut="Space" side="top">
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              disabled={!playable}
              onClick={() => previewEngine.toggle()}
              className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-app transition-colors hover:bg-white disabled:opacity-30"
            >
              {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
            </button>
          </Tooltip>
          <IconButton icon={StepForward} label="Next frame" shortcut="→" tooltipSide="top" disabled={!playable} onClick={() => previewEngine.step(1, fps)} />
          <IconButton icon={SkipForward} label="Go to end" shortcut="End" tooltipSide="top" disabled={!playable} onClick={() => previewEngine.seek(duration)} />
        </div>

        <div className="flex items-center justify-end gap-1">
          <VolumeControl />
          <Tooltip label="Aspect ratio" side="top">
            <Select
              compact
              ariaLabel="Aspect ratio"
              value={aspect}
              options={ASPECT_RATIOS.map((a) => ({ value: a.value, label: a.label }))}
              onChange={setAspect}
              className="w-[62px]"
            />
          </Tooltip>
          <Tooltip label="Preview quality" side="top">
            <Select compact ariaLabel="Preview quality" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} className="w-[92px]" />
          </Tooltip>
          <IconButton icon={Maximize} label="Fullscreen preview" shortcut="F" tooltipSide="top" onClick={togglePreviewFullscreen} />
        </div>
      </div>
    </div>
  );
}
