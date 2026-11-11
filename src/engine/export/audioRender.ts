import { audioEnvelopeAt, clipAudio, createAudioChain, ensureAudioWorklet } from '../audio';
import type { Sequence } from '../sequence';
import { sourceTimeAt } from '../timelineModel';
import { decodeMediaAudio, timeStretch } from '../../services/audioDsp';

// ---------------------------------------------------------------------------
// Offline audio mixdown for export: every audible clip (audio files and the
// audio of video clips) through the same chain + envelope as the preview
// mixer, summed per track bus (track volume), rendered by OfflineAudioContext
// (runs off the main thread). Speed changes are time-stretched with pitch
// preserved, like the preview's media elements.
// ---------------------------------------------------------------------------

export const EXPORT_SAMPLE_RATE = 48000;
/** Envelope automation resolution (points per second). */
const ENVELOPE_RATE = 200;

export interface AudioMixResult {
  buffer: AudioBuffer;
  /** Clips that contributed audio. */
  clips: number;
  /** Clips skipped, with the reason (shown to the user – nothing is dropped silently). */
  skipped: { name: string; reason: string }[];
}

export async function renderAudioMix(
  seq: Sequence,
  duration: number,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<AudioMixResult> {
  const sr = EXPORT_SAMPLE_RATE;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sr)), sr);
  const gateOk = await ensureAudioWorklet(ctx);
  const buses = new Map<string, GainNode>();
  const bus = (trackId: string, volume: number) => {
    let g = buses.get(trackId);
    if (!g) {
      g = ctx.createGain();
      g.gain.value = volume;
      g.connect(ctx.destination);
      buses.set(trackId, g);
    }
    return g;
  };

  const candidates = seq.items.filter((it) => it.media && (it.media.kind === 'audio' || it.media.kind === 'video'));
  const skipped: AudioMixResult['skipped'] = [];
  let used = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const it = candidates[i];
    const clip = it.clip;
    onProgress((i / Math.max(1, candidates.length)) * 0.6);
    if (!it.audible) continue; // muted track: intentionally silent, as in the preview
    if (clip.reversed) {
      skipped.push({ name: clip.name, reason: 'reversed audio is muted (same as the preview)' });
      continue;
    }
    const buf = await decodeMediaAudio(it.media!.url);
    if (!buf) continue; // the file has no audio track
    // Source range covered by the clip's render range (transitions extend it).
    const a = sourceTimeAt(clip, it.renderStart);
    const b = sourceTimeAt(clip, it.renderEnd);
    const srcFrom = Math.max(0, a);
    const srcTo = Math.min(buf.duration, b);
    if (srcTo - srcFrom < 1 / sr) continue;
    const startAt = it.renderStart + (srcFrom - a) / clip.speed;
    const f0 = Math.floor(srcFrom * buf.sampleRate);
    const f1 = Math.min(buf.length, Math.ceil(srcTo * buf.sampleRate));
    let seg = ctx.createBuffer(buf.numberOfChannels, Math.max(1, f1 - f0), buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) seg.copyToChannel(buf.getChannelData(c).subarray(f0, f1), c);
    seg = await timeStretch(ctx, seg, clip.speed);

    const src = ctx.createBufferSource();
    src.buffer = seg;
    const chain = createAudioChain(ctx, clipAudio(clip), gateOk);
    const env = ctx.createGain();
    // Envelope sampled from the SAME function the preview uses each frame.
    const span = it.renderEnd - it.renderStart;
    const points = Math.max(2, Math.ceil(span * ENVELOPE_RATE) + 1);
    const curve = new Float32Array(points);
    for (let k = 0; k < points; k++) curve[k] = audioEnvelopeAt(it, seq.transitions, it.renderStart + (k / (points - 1)) * span - (k === points - 1 ? 1e-6 : 0));
    env.gain.setValueAtTime(curve[0], 0);
    env.gain.setValueCurveAtTime(curve, Math.max(0, it.renderStart), span);
    src.connect(chain.input);
    chain.output.connect(env);
    env.connect(bus(clip.trackId, it.trackVolume));
    src.start(Math.max(0, startAt));
    used++;
  }
  onProgress(0.65);
  const buffer = await ctx.startRendering();
  onProgress(1);
  return { buffer, clips: used, skipped };
}
