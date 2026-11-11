import { useState } from 'react';
import { AudioLines, Loader2, RotateCcw, Scissors, Wand2 } from 'lucide-react';
import { clipAudio, EQ_LABELS } from '../../engine/audio';
import { clipDuration } from '../../engine/timelineModel';
import { extractAudio, normalizeClip, resetClipAudio, setClipAudio } from '../../services/audioEditing';
import type { Clip, Track } from '../../types';
import { Button } from '../controls/Button';
import { PropertySection } from './PropertySection';
import { AnimatedSlider, SliderRow } from './controls';

const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const secs = (v: number) => `${v.toFixed(2)} s`;

export function AudioSection({ clip, track, locked, isVideo }: { clip: Clip; track: Track | undefined; locked: boolean; isVideo: boolean }) {
  const a = clipAudio(clip);
  const k = (p: string) => `clip.${clip.id}.audio.${p}`;
  const set = (patch: Partial<typeof a>, key: string) => setClipAudio(clip.id, patch, k(key));
  const maxFade = Math.max(0.1, Math.min(10, clipDuration(clip)));
  const [busy, setBusy] = useState<'normalize' | 'extract' | null>(null);
  const run = async (what: 'normalize' | 'extract') => {
    setBusy(what);
    try {
      if (what === 'normalize') await normalizeClip(clip.id);
      else await extractAudio(clip.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PropertySection title="Audio">
      <AnimatedSlider clip={clip} prop="volume" label="Clip volume" disabled={locked} />
      <SliderRow label="Gain" value={a.gainDb} min={-24} max={24} step={0.5} format={db} resetTo={0} disabled={locked} onChange={(gainDb) => set({ gainDb }, 'gain')} />
      <div className="flex gap-1.5">
        <Button className="flex-1 px-1!" disabled={locked || busy !== null} onClick={() => void run('normalize')} title="Set the gain so the clip's peak reaches -1 dBFS">
          {busy === 'normalize' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Normalize
        </Button>
        {isVideo && (
          <Button className="flex-1 px-1!" disabled={locked || busy !== null} onClick={() => void run('extract')} title="Move this video's sound to its own audio clip">
            {busy === 'extract' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />} Extract audio
          </Button>
        )}
      </div>
      <SliderRow label="Fade in" value={a.fadeIn} min={0} max={maxFade} step={0.05} format={secs} resetTo={0} disabled={locked} onChange={(fadeIn) => set({ fadeIn }, 'fadeIn')} />
      <SliderRow label="Fade out" value={a.fadeOut} min={0} max={maxFade} step={0.05} format={secs} resetTo={0} disabled={locked} onChange={(fadeOut) => set({ fadeOut }, 'fadeOut')} />
      <SliderRow label="Bass" value={a.bass} min={-15} max={15} step={0.5} format={db} resetTo={0} disabled={locked} onChange={(bass) => set({ bass }, 'bass')} />
      <SliderRow label="Treble" value={a.treble} min={-15} max={15} step={0.5} format={db} resetTo={0} disabled={locked} onChange={(treble) => set({ treble }, 'treble')} />
      <div className="space-y-2 rounded-md border border-line p-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          <AudioLines size={11} /> Equalizer
        </div>
        {EQ_LABELS.map((label, i) => (
          <SliderRow
            key={label}
            label={`EQ ${label} Hz`}
            value={a.eq[i]}
            min={-12}
            max={12}
            step={0.5}
            format={db}
            resetTo={0}
            disabled={locked}
            onChange={(v) => {
              const eq = [...a.eq] as typeof a.eq;
              eq[i] = v;
              set({ eq }, `eq${i}`);
            }}
          />
        ))}
      </div>
      <SliderRow
        label="Balance"
        value={a.pan}
        min={-1}
        max={1}
        step={0.02}
        format={(v) => (Math.abs(v) < 0.01 ? 'Centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`)}
        resetTo={0}
        disabled={locked}
        onChange={(pan) => set({ pan }, 'pan')}
      />
      <SliderRow
        label="Noise reduction"
        value={a.noiseReduction}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        resetTo={0}
        disabled={locked}
        onChange={(noiseReduction) => set({ noiseReduction }, 'nr')}
      />
      <p className="text-[10px] leading-relaxed text-fg-subtle">Noise reduction = rumble filter + noise gate (removes hiss / hum between words, not under speech).</p>
      <Button variant="ghost" className="w-full" disabled={locked} onClick={() => resetClipAudio(clip.id)}>
        <RotateCcw size={12} /> Reset audio
      </Button>
      {track?.muted && <p className="text-[11px] text-warning">The track is muted.</p>}
      {clip.reversed && <p className="text-[11px] text-warning">Audio is muted while the clip is reversed.</p>}
    </PropertySection>
  );
}
