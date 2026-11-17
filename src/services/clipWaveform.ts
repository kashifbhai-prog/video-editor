import { create } from 'zustand';
import type { MediaItem } from '../types';

// ---------------------------------------------------------------------------
// Audio waveforms for video clips on the timeline (CapCut-style strip under the
// filmstrip). Audio files get their waveform at import; video files don't, so
// it is computed here lazily – only for media that is on the timeline, one file
// at a time – and kept in memory (cheap to recompute after a reload).
// ---------------------------------------------------------------------------

interface WaveformState {
  /** Peaks 0..1 per media id; an empty array means "no audio track". */
  peaks: Record<string, number[]>;
}

export const useClipWaveformStore = create<WaveformState>()(() => ({ peaks: {} }));

/** Peaks per second of media (capped), so short clips still look detailed when zoomed in. */
const PEAKS_PER_SECOND = 40;
const MIN_PEAKS = 400;
const MAX_PEAKS = 12000;
/** Larger files are skipped: decoding needs the whole file in memory. */
const MAX_BYTES = 400 * 1024 * 1024;
/** Decoding at a low rate keeps memory small (peaks don't need full quality). */
const DECODE_RATE = 8000;

const queue: MediaItem[] = [];
const requested = new Set<string>();
let running = false;

/** Requests the waveform of a video media item (no-op if known or already requested). */
export function requestClipWaveform(media: MediaItem) {
  if (media.kind !== 'video' || media.status !== 'ready' || !media.duration || media.waveform || requested.has(media.id)) return;
  requested.add(media.id);
  queue.push(media);
  void drain();
}

export function releaseClipWaveform(mediaId: string) {
  requested.delete(mediaId);
  useClipWaveformStore.setState((s) => {
    if (!s.peaks[mediaId]) return s;
    const { [mediaId]: _removed, ...rest } = s.peaks;
    return { peaks: rest };
  });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    for (let media = queue.shift(); media; media = queue.shift()) {
      const peaks = await compute(media);
      if (requested.has(media.id)) useClipWaveformStore.setState((s) => ({ peaks: { ...s.peaks, [media!.id]: peaks } }));
    }
  } finally {
    running = false;
  }
}

async function compute(media: MediaItem): Promise<number[]> {
  if (media.size > MAX_BYTES) return [];
  try {
    const bytes = await (await fetch(media.url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, DECODE_RATE);
    const buffer = await ctx.decodeAudioData(bytes);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const length = buffer.length;
    const bars = Math.max(MIN_PEAKS, Math.min(MAX_PEAKS, Math.round(buffer.duration * PEAKS_PER_SECOND)));
    const block = Math.max(1, Math.floor(length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const from = i * block;
      const to = Math.min(length, from + block);
      for (const data of channels) {
        for (let j = from; j < to; j++) {
          const v = Math.abs(data[j]);
          if (v > max) max = v;
        }
      }
      peaks.push(max);
    }
    const top = Math.max(...peaks);
    // Silent track (or none): nothing to draw.
    if (top < 1e-4) return [];
    return peaks.map((p) => Math.round((p / top) * 1000) / 1000);
  } catch {
    // No audio track, or a codec the browser can't decode.
    return [];
  }
}
