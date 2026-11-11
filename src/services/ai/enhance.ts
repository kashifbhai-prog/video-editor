import { create } from 'zustand';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { clipAudio, createAudioChain, DEFAULT_CLIP_AUDIO, ensureAudioWorklet, gainToDb } from '../../engine/audio';
import { activeLoudness, levelEnvelope, levelStats, peakOfMono, toMono } from '../../engine/ai/audioAnalysis';
import { clipEnd } from '../../engine/timelineModel';
import { decodeMediaAudio, timeStretch } from '../audioDsp';
import { importAudioBuffer, placeAudioForVideoClip } from '../audioEditing';
import { selectClips } from '../editingService';
import type { Clip, ClipAudio, MediaItem } from '../../types';
import { runAiJob, throwIfAborted, type JobControl } from './aiJobs';
import { track } from '../analytics';
import { denoiseAudio, limitAudio } from './aiWorkerClient';

// ---------------------------------------------------------------------------
// Audio enhancement. "Apply" renders an enhanced copy of the clip's audio
// file (the original stays in the library; the edit is one undo step):
//   1. AI noise removal – RNNoise (recurrent neural network), latency-compensated
//   2. Voice clarity   – rumble cut, de-mud, presence and air (the same EQ
//                        chain the editor uses everywhere)
//   3. Loudness        – speech loudness (voiced parts) brought to the target,
//                        with a look-ahead peak limiter so nothing clips
// The A/B preview runs exactly this pipeline on a few seconds of the clip.
// Automatic balancing sets clip gains so all clips have the same speech
// loudness (peak-safe, non-destructive).
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

export type VoicePreset = 'off' | 'light' | 'clear' | 'strong';

export interface EnhanceOptions {
  /** RNNoise neural noise removal. */
  denoise: boolean;
  /** 0..1 – mix of the denoised signal. */
  denoiseStrength: number;
  voice: VoicePreset;
  /** Bring speech loudness to the target (with peak limiting). */
  normalize: boolean;
}

export const DEFAULT_ENHANCE: EnhanceOptions = { denoise: true, denoiseStrength: 1, voice: 'clear', normalize: true };

/** Speech loudness target (mean power of the voiced parts, dBFS) and peak ceiling. */
export const LOUDNESS_TARGET = -16;
const PEAK_CEILING = -1;

// eq bands: 60 Hz, 250 Hz, 1 kHz, 4 kHz, 12 kHz
const VOICE_PRESETS: Record<VoicePreset, Partial<ClipAudio> | null> = {
  off: null,
  light: { eq: [-3, -1, 0, 2, 1], treble: 1 },
  clear: { eq: [-6, -2.5, 0.5, 3.5, 2], bass: -1, treble: 2 },
  strong: { eq: [-9, -4, 1, 5, 3], bass: -2, treble: 3 },
};

const mediaOf = (clip: Clip): MediaItem | undefined => useMediaStore.getState().items.find((m) => m.id === clip.mediaId);
const hasAudio = (m: MediaItem | undefined) => !!m && (m.kind === 'audio' || m.kind === 'video');

function bufferFrom(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const b = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate });
  channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

function slice(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
  return bufferFrom(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice(a, Math.max(a + 1, b))), buf.sampleRate);
}

/** Speech loudness (dBFS) and peak (dBFS) of a mono signal; loudness null when silent. */
export function measureSpeech(mono: Float32Array, sampleRate: number): { loudness: number | null; peak: number } {
  const env = levelEnvelope(mono, sampleRate);
  return { loudness: activeLoudness(env, levelStats(env).threshold), peak: gainToDb(peakOfMono(mono)) };
}

/** Gain (dB) bringing speech to the target without the peak passing the ceiling (no limiter). */
export function peakSafeGain(mono: Float32Array, sampleRate: number): number | null {
  const m = measureSpeech(mono, sampleRate);
  if (m.loudness === null || m.peak < -100) return null;
  const g = Math.min(LOUDNESS_TARGET - m.loudness, PEAK_CEILING - m.peak);
  return Math.round(Math.max(-24, Math.min(24, g)) * 10) / 10;
}

/** Runs a buffer through the shared EQ chain (voice preset) offline. */
async function applyVoiceEq(buf: AudioBuffer, preset: Partial<ClipAudio>): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const gate = await ensureAudioWorklet(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const chain = createAudioChain(ctx, { ...DEFAULT_CLIP_AUDIO, eq: [0, 0, 0, 0, 0], ...preset }, gate);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/**
 * The enhancement pipeline on `buf`. Loudness is measured on [measureFrom,
 * measureTo) (the clip's range) so the whole file gets one consistent gain.
 */
async function processAudio(buf: AudioBuffer, opts: EnhanceOptions, measure: [number, number], ctl: JobControl, range: [number, number]): Promise<{ out: AudioBuffer; gainDb: number | null }> {
  const [lo, hi] = range;
  let cur = buf;
  if (opts.denoise) {
    const channels = Array.from({ length: cur.numberOfChannels }, (_, c) => cur.getChannelData(c).slice());
    const r = await denoiseAudio(channels, cur.sampleRate, opts.denoiseStrength, ctl, [lo, lo + (hi - lo) * 0.75]);
    cur = bufferFrom(r.channels, cur.sampleRate);
  }
  throwIfAborted(ctl.signal);
  const preset = VOICE_PRESETS[opts.voice];
  if (preset) {
    ctl.progress('Voice clarity', lo + (hi - lo) * 0.8);
    cur = await applyVoiceEq(cur, preset);
  }
  throwIfAborted(ctl.signal);
  let gainDb: number | null = null;
  if (opts.normalize) {
    ctl.progress('Loudness', lo + (hi - lo) * 0.9);
    const part = slice(cur, measure[0], measure[1]);
    const m = measureSpeech(toMono(part), part.sampleRate);
    if (m.loudness !== null) {
      gainDb = Math.round(Math.max(-24, Math.min(24, LOUDNESS_TARGET - m.loudness)) * 10) / 10;
      const channels = Array.from({ length: cur.numberOfChannels }, (_, c) => cur.getChannelData(c).slice());
      cur = bufferFrom(await limitAudio(channels, cur.sampleRate, gainDb, PEAK_CEILING, ctl), cur.sampleRate);
    }
  }
  return { out: cur, gainDb };
}

// ---- Apply ------------------------------------------------------------------------------

export async function enhanceClip(clipId: string, opts: EnhanceOptions): Promise<boolean> {
  const clip = project().document.clips[clipId];
  const media = clip && mediaOf(clip);
  if (!clip || !hasAudio(media)) {
    notify('Select a video or audio clip with sound.', 'warning');
    return false;
  }
  if (!opts.denoise && opts.voice === 'off' && !opts.normalize) {
    notify('Choose at least one enhancement.', 'info');
    return false;
  }
  const r = await runAiJob('enhance', 'Audio enhancement', async (ctl) => {
    ctl.progress('Reading audio', 0.02);
    const buf = await decodeMediaAudio(media!.url);
    if (!buf) throw new Error(`"${media!.name}" has no audio track.`);
    throwIfAborted(ctl.signal);
    const { out } = await processAudio(buf, opts, [clip.sourceIn, clip.sourceOut], ctl, [0.05, 0.92]);
    throwIfAborted(ctl.signal);
    const current = project().document.clips[clipId];
    if (!current) throw new Error('The clip was deleted.');
    ctl.progress('Saving enhanced audio', 0.95);
    const name = `${media!.name.replace(/\.[^.]+$/, '')} (enhanced).wav`;
    const clean = await importAudioBuffer(out, name, false);
    if (!clean) throw new Error('The enhanced audio could not be imported.');
    // The processing is in the file now: the clip's own EQ / gain / gate go neutral
    // (fades, balance, volume and keyframes stay).
    const a = clipAudio(current);
    const neutral: Partial<ClipAudio> = { gainDb: 0, bass: 0, treble: 0, eq: [0, 0, 0, 0, 0], noiseReduction: 0, fadeIn: a.fadeIn, fadeOut: a.fadeOut, pan: a.pan };
    if (media!.kind === 'video') return placeAudioForVideoClip(clipId, clean, '(enhanced)', neutral);
    project().commit((d) => {
      const c = d.clips[clipId];
      return c ? { ...d, clips: { ...d.clips, [clipId]: { ...c, mediaId: clean.id, name: `${c.name} (enhanced)`, audio: { ...a, ...neutral } } } } : d;
    });
    return clipId;
  });
  if (r) {
    selectClips([r]);
    notify('Audio enhanced (the original file is kept in the library). Undo with Ctrl+Z.', 'success');
    track('ai_audio_enhanced', { denoise: opts.denoise, voice: opts.voice, normalize: opts.normalize });
  }
  return !!r;
}

/** Measures a clip's speech through its own processing chain (what the export hears). */
async function processedClipMono(clip: Clip, buf: AudioBuffer): Promise<Float32Array> {
  const part = slice(buf, clip.sourceIn, clip.sourceOut);
  const ctx = new OfflineAudioContext(part.numberOfChannels, part.length, part.sampleRate);
  const gate = await ensureAudioWorklet(ctx);
  const src = ctx.createBufferSource();
  src.buffer = part;
  const chain = createAudioChain(ctx, { ...clipAudio(clip), gainDb: 0, fadeIn: 0, fadeOut: 0 }, gate);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start(0);
  return toMono(await ctx.startRendering());
}

/** Automatic volume balancing: every audible clip's speech loudness to the same target (one undo step). */
export async function balanceVolumes(ids?: string[]): Promise<number> {
  const doc = project().document;
  const muted = new Set(doc.tracks.filter((t) => t.muted).map((t) => t.id));
  const clips = (ids ? ids.map((id) => doc.clips[id]) : Object.values(doc.clips)).filter((c) => c && !muted.has(c.trackId) && c.volume > 0 && hasAudio(mediaOf(c)));
  if (!clips.length) {
    notify('There are no audible clips to balance.', 'info');
    return 0;
  }
  const gains = await runAiJob('enhance', 'Volume balancing', async (ctl) => {
    const measured: { id: string; loud: number; peak: number }[] = [];
    for (let i = 0; i < clips.length; i++) {
      throwIfAborted(ctl.signal);
      ctl.progress(`Measuring ${i + 1} / ${clips.length}`, i / clips.length);
      const buf = await decodeMediaAudio(mediaOf(clips[i])!.url);
      if (!buf) continue;
      const m = measureSpeech(await processedClipMono(clips[i], buf), buf.sampleRate);
      if (m.loudness !== null) measured.push({ id: clips[i].id, loud: m.loudness, peak: m.peak });
    }
    // One common level everyone can reach without clipping: the target, or
    // lower when a clip's peaks would pass the ceiling.
    const level = Math.min(LOUDNESS_TARGET, ...measured.map((m) => m.loud + (PEAK_CEILING - m.peak)));
    return new Map(measured.map((m) => [m.id, Math.round(Math.max(-24, Math.min(24, level - m.loud)) * 10) / 10]));
  });
  if (!gains?.size) return 0;
  const n = project().updateClips([...gains.keys()], (c) => ({ audio: { ...clipAudio(c), gainDb: gains.get(c.id)! } }));
  notify(`Balanced ${n} clip${n === 1 ? '' : 's'} to the same speech loudness.`, 'success');
  return n;
}

// ---- Preview (A/B) --------------------------------------------------------------------------

interface PreviewState {
  playing: 'original' | 'enhanced' | null;
  rendering: boolean;
}
export const useEnhancePreview = create<PreviewState>()(() => ({ playing: null, rendering: false }));

const PREVIEW_SECONDS = 8;
let previewCtx: AudioContext | null = null;
let previewSrc: AudioBufferSourceNode | null = null;
const previewCache = new Map<string, AudioBuffer>();

export function stopEnhancePreview() {
  try {
    previewSrc?.stop();
  } catch {
    /* already stopped */
  }
  previewSrc = null;
  useEnhancePreview.setState({ playing: null });
}

/** A few seconds of the clip (from `from`, timeline time) through the clip's chain, as the editor plays it. */
async function renderThroughClip(clip: Clip, src: AudioBuffer, srcFrom: number, params: ClipAudio): Promise<AudioBuffer> {
  const sr = 48000;
  const len = Math.min(PREVIEW_SECONDS, (src.duration - srcFrom) / clip.speed);
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(len * sr)), sr);
  let seg: AudioBuffer = slice(src, srcFrom, srcFrom + len * clip.speed);
  seg = await timeStretch(ctx, seg, clip.speed);
  const gate = await ensureAudioWorklet(ctx);
  const node = ctx.createBufferSource();
  node.buffer = seg;
  const chain = createAudioChain(ctx, params, gate);
  const vol = ctx.createGain();
  vol.gain.value = clip.volume;
  node.connect(chain.input);
  chain.output.connect(vol).connect(ctx.destination);
  node.start(0);
  return ctx.startRendering();
}

/** Plays the original or the enhanced version of a clip (8 s from the playhead, or from the clip start). */
export async function playEnhancePreview(clipId: string, opts: EnhanceOptions, which: 'original' | 'enhanced') {
  stopEnhancePreview();
  const clip = project().document.clips[clipId];
  const media = clip && mediaOf(clip);
  if (!clip || !hasAudio(media)) return;
  const t = usePlaybackStore.getState().timelineTime;
  const from = t >= clip.start && t < clipEnd(clip) - 0.5 ? t : clip.start;
  const srcFrom = clip.sourceIn + (from - clip.start) * clip.speed;
  const key = `${clipId}|${which}|${from.toFixed(2)}|${JSON.stringify(clip.audio)}|${clip.sourceIn}|${clip.sourceOut}|${which === 'enhanced' ? JSON.stringify(opts) : ''}`;
  let out = previewCache.get(key);
  if (!out) {
    useEnhancePreview.setState({ rendering: true });
    try {
      const buf = await decodeMediaAudio(media!.url);
      if (!buf) return notify('This clip has no audio.', 'warning');
      if (which === 'original') out = await renderThroughClip(clip, buf, srcFrom, clipAudio(clip));
      else {
        // The real pipeline on the excerpt (+0.5 s lead-in for the noise network to settle).
        const lead = Math.min(0.5, srcFrom);
        const part = slice(buf, srcFrom - lead, srcFrom + PREVIEW_SECONDS * clip.speed);
        const ac = new AbortController();
        const ctl: JobControl = { signal: ac.signal, progress: () => {} };
        // Loudness is measured over the clip as "Apply" does (peak limiting keeps it safe).
        const measured = await processAudio(slice(buf, clip.sourceIn, Math.min(clip.sourceOut, clip.sourceIn + 60)), { ...opts, normalize: false }, [0, 60], ctl, [0, 1]);
        const m = measureSpeech(toMono(measured.out), buf.sampleRate);
        const processed = await processAudio(part, { ...opts, normalize: false }, [0, 0], ctl, [0, 1]);
        let cur = processed.out;
        if (opts.normalize && m.loudness !== null) {
          const g = Math.max(-24, Math.min(24, LOUDNESS_TARGET - m.loudness));
          const channels = Array.from({ length: cur.numberOfChannels }, (_, c) => cur.getChannelData(c).slice());
          cur = bufferFrom(await limitAudio(channels, cur.sampleRate, g, PEAK_CEILING, ctl), cur.sampleRate);
        }
        const a = clipAudio(clip);
        out = await renderThroughClip(clip, slice(cur, lead, cur.duration), 0, { ...a, gainDb: 0, bass: 0, treble: 0, eq: [0, 0, 0, 0, 0], noiseReduction: 0 });
      }
      if (previewCache.size > 6) previewCache.delete(previewCache.keys().next().value!);
      previewCache.set(key, out);
    } finally {
      useEnhancePreview.setState({ rendering: false });
    }
  }
  previewCtx ??= new AudioContext();
  await previewCtx.resume();
  const node = previewCtx.createBufferSource();
  node.buffer = out;
  node.connect(previewCtx.destination);
  node.onended = () => {
    if (previewSrc === node) stopEnhancePreview();
  };
  previewSrc = node;
  node.start();
  useEnhancePreview.setState({ playing: which });
}

export const _previewCacheForTests = previewCache;
