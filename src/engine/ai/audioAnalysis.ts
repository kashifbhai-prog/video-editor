import type { TimeRange } from '../rippleEdit';

// ---------------------------------------------------------------------------
// Signal analysis used by the AI tools: level envelopes, silence detection,
// speech windows for the recogniser, loudness. Pure functions over PCM.
// ---------------------------------------------------------------------------

/** Analysis hop (seconds) of level envelopes. */
export const LEVEL_HOP = 0.01;
const FLOOR_DB = -100;

export function toMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** RMS level in dBFS over 20 ms windows every 10 ms. */
export function levelEnvelope(mono: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.round(sampleRate * LEVEL_HOP);
  const win = hop * 2;
  const n = Math.max(1, Math.ceil(mono.length / hop));
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * hop - hop / 2;
    let s = 0;
    let c = 0;
    for (let i = Math.max(0, a); i < Math.min(mono.length, a + win); i++) {
      s += mono[i] * mono[i];
      c++;
    }
    const rms = c ? Math.sqrt(s / c) : 0;
    out[k] = rms > 1e-5 ? 20 * Math.log10(rms) : FLOOR_DB;
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] ?? FLOOR_DB;
}

export interface LevelStats {
  /** Background level (10th percentile, dBFS). */
  floor: number;
  /** Typical loud level (95th percentile, dBFS). */
  speech: number;
  /** Suggested silence threshold (dBFS). */
  threshold: number;
}

/** Adaptive threshold between the noise floor and the speech level. */
export function levelStats(env: Float32Array): LevelStats {
  const floor = Math.max(-80, percentile(env, 0.1));
  const speech = percentile(env, 0.95);
  const threshold = Math.min(speech - 6, Math.max(-60, floor + 0.35 * (speech - floor)));
  return { floor, speech, threshold };
}

export interface SilenceOptions {
  /** dBFS; below = silent. */
  threshold: number;
  /** Seconds a pause must last to count. */
  minDuration: number;
  /** Seconds of pause kept on each side of a cut (natural breathing room). */
  padding: number;
}

/** Ranges (seconds) quieter than the threshold for at least minDuration, shrunk by the padding. */
export function detectSilences(env: Float32Array, o: SilenceOptions, totalDuration = env.length * LEVEL_HOP): TimeRange[] {
  const out: TimeRange[] = [];
  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const s = runStart * LEVEL_HOP;
    const e = Math.min(totalDuration, endIdx * LEVEL_HOP);
    // A pause at the very start / end needs no padding on its open side.
    const ps = runStart === 0 ? 0 : o.padding;
    const pe = endIdx >= env.length ? 0 : o.padding;
    if (e - s >= o.minDuration && e - pe - (s + ps) > 0.05) out.push({ start: s + ps, end: e - pe });
    runStart = -1;
  };
  for (let k = 0; k < env.length; k++) {
    if (env[k] < o.threshold) {
      if (runStart < 0) runStart = k;
    } else flush(k);
  }
  flush(env.length);
  return out;
}

/**
 * Windows (≤ maxLen s) that contain speech, for the recogniser: voiced regions
 * merged across short gaps, padded, and split at the quietest point when long.
 * Skipping silence avoids Whisper's well-known hallucinations on empty audio.
 */
export function speechWindows(env: Float32Array, threshold: number, totalDuration: number, maxLen = 28): TimeRange[] {
  const voiced = detectSilences(env.map((v) => (v < threshold ? 0 : -200)) as Float32Array, { threshold: -100, minDuration: 0.08, padding: 0 }, totalDuration);
  const merged: TimeRange[] = [];
  for (const r of voiced) {
    const s = Math.max(0, r.start - 0.3);
    const e = Math.min(totalDuration, r.end + 0.3);
    const last = merged[merged.length - 1];
    if (last && s - last.end < 0.8 && e - last.start <= maxLen) last.end = e;
    else merged.push({ start: s, end: e });
  }
  // Split windows that are still too long at their quietest 100 ms.
  const out: TimeRange[] = [];
  for (const w of merged) {
    let s = w.start;
    while (w.end - s > maxLen) {
      const from = Math.floor((s + maxLen * 0.6) / LEVEL_HOP);
      const to = Math.floor((s + maxLen) / LEVEL_HOP);
      let best = to;
      for (let k = from; k < to; k++) if (env[k] < env[best]) best = k;
      out.push({ start: s, end: best * LEVEL_HOP });
      s = best * LEVEL_HOP;
    }
    out.push({ start: s, end: w.end });
  }
  return out;
}

/** Speech loudness: mean power of the frames above the threshold (dBFS), or null when silent. */
export function activeLoudness(env: Float32Array, threshold: number): number | null {
  let p = 0;
  let n = 0;
  for (const v of env) {
    if (v >= threshold) {
      p += 10 ** (v / 10);
      n++;
    }
  }
  return n ? 10 * Math.log10(p / n) : null;
}

export function peakOfMono(mono: Float32Array): number {
  let m = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > m) m = a;
  }
  return m;
}
