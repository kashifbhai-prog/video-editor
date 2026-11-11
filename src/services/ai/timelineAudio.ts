import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { buildTimelineSequence } from '../../engine/sequence';
import { renderAudioMix } from '../../engine/export/audioRender';
import { toMono } from '../../engine/ai/audioAnalysis';
import type { JobControl } from './aiJobs';

// ---------------------------------------------------------------------------
// The timeline's audio, rendered through the SAME offline mixdown the export
// uses (speed, fades, gain, EQ, track volume, mute). Analyses therefore work
// in timeline time and see exactly what will be heard in the exported video.
// ---------------------------------------------------------------------------

export interface TimelineAudio {
  mono: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Renders the timeline mix (or only `clipIds`) to mono PCM. `range` maps the
 * render onto the caller's job progress.
 */
export async function renderTimelineAudio(
  opts: { clipIds?: string[]; sampleRate: number },
  ctl: JobControl,
  range: [number, number],
): Promise<TimelineAudio | null> {
  const doc = useProjectStore.getState().document;
  const media = new Map(useMediaStore.getState().items.map((m) => [m.id, m]));
  const seq = buildTimelineSequence(doc, media);
  if (opts.clipIds) {
    const ids = new Set(opts.clipIds);
    seq.items = seq.items.filter((it) => ids.has(it.clip.id));
  }
  const withAudio = seq.items.filter((it) => it.audible && it.media && (it.media.kind === 'audio' || it.media.kind === 'video'));
  if (!withAudio.length || seq.duration <= 0) return null;
  const duration = Math.max(...withAudio.map((it) => it.renderEnd));
  const [lo, hi] = range;
  const mix = await renderAudioMix(seq, duration, ctl.signal, (f) => ctl.progress('Reading audio', lo + f * (hi - lo)), opts.sampleRate);
  return { mono: toMono(mix.buffer), sampleRate: opts.sampleRate, duration };
}
