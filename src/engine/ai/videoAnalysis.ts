// ---------------------------------------------------------------------------
// Visual analysis for smart editing: frame features sampled from a video file
// (decoded frame-accurately with WebCodecs via Mediabunny, analysed at
// 64×36), scene-cut detection with frame-exact refinement, and the detectors
// behind the edit suggestions (repeated takes, frozen / dark / blurry
// footage). The feature maths is pure; sampling is async and cancellable.
// ---------------------------------------------------------------------------

export const FEATURE_W = 64;
export const FEATURE_H = 36;

export interface FrameFeature {
  /** Source time (seconds). */
  t: number;
  /** RGB histogram, 3 × 16 bins, normalised to sum 1 per channel. */
  hist: Float32Array;
  /** Mean luma 0..1. */
  luma: number;
  /** Variance of the Laplacian (focus measure). */
  sharp: number;
  /** Mean absolute luma change vs. the previous sample, 0..1. */
  motion: number;
  /** 64-bit difference hash (8 bytes). */
  hash: Uint8Array;
}

/** Features of one 64×36 RGBA frame. */
export function frameFeature(t: number, rgba: Uint8ClampedArray, prevLuma: Float32Array | null): { f: FrameFeature; luma: Float32Array } {
  const n = FEATURE_W * FEATURE_H;
  const hist = new Float32Array(48);
  const L = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    hist[r >> 4]++;
    hist[16 + (g >> 4)]++;
    hist[32 + (b >> 4)]++;
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    L[i] = y;
    sum += y;
  }
  for (let i = 0; i < 48; i++) hist[i] /= n;
  // Laplacian variance.
  let ls = 0;
  let ls2 = 0;
  let cnt = 0;
  for (let y = 1; y < FEATURE_H - 1; y++) {
    for (let x = 1; x < FEATURE_W - 1; x++) {
      const i = y * FEATURE_W + x;
      const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - FEATURE_W] - L[i + FEATURE_W];
      ls += lap;
      ls2 += lap * lap;
      cnt++;
    }
  }
  const sharp = ls2 / cnt - (ls / cnt) ** 2;
  let motion = 0;
  if (prevLuma) {
    for (let i = 0; i < n; i++) motion += Math.abs(L[i] - prevLuma[i]);
    motion /= n;
  }
  // dHash on a 9×8 grid of block means.
  const grid = new Float32Array(72);
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x0 = Math.floor((gx * FEATURE_W) / 9);
      const x1 = Math.floor(((gx + 1) * FEATURE_W) / 9);
      const y0 = Math.floor((gy * FEATURE_H) / 8);
      const y1 = Math.floor(((gy + 1) * FEATURE_H) / 8);
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += L[y * FEATURE_W + x];
      grid[gy * 9 + gx] = s / Math.max(1, (x1 - x0) * (y1 - y0));
    }
  }
  const hash = new Uint8Array(8);
  for (let gy = 0; gy < 8; gy++) {
    let byte = 0;
    for (let gx = 0; gx < 8; gx++) if (grid[gy * 9 + gx] > grid[gy * 9 + gx + 1]) byte |= 1 << gx;
    hash[gy] = byte;
  }
  return { f: { t, hist, luma: sum / n, sharp, motion, hash }, luma: L };
}

/** Histogram distance (0 = identical, 1 = disjoint): half the mean per-channel L1. */
export function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < 48; i++) d += Math.abs(a[i] - b[i]);
  return d / 6;
}

export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < 8; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Combined change between two samples (colour distribution + structure). */
export const frameChange = (a: FrameFeature, b: FrameFeature) => histDistance(a.hist, b.hist) * 0.6 + (hamming(a.hash, b.hash) / 64) * 0.4 + b.motion * 0.5;

/**
 * Candidate cuts between consecutive samples: change well above the clip's
 * typical frame-to-frame change (adaptive), or above an absolute floor.
 */
export function candidateCuts(features: FrameFeature[]): number[] {
  if (features.length < 3) return [];
  const d = features.slice(1).map((f, i) => frameChange(features[i], f));
  const sorted = [...d].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mad = sorted.map((x) => Math.abs(x - median)).sort((x, y) => x - y)[Math.floor(sorted.length / 2)];
  const thr = Math.max(0.18, median + 8 * mad);
  const out: number[] = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i] < thr) continue;
    // Local maximum (one cut per transition).
    if ((i > 0 && d[i - 1] > d[i]) || (i + 1 < d.length && d[i + 1] > d[i])) continue;
    out.push(i + 1); // index of the first sample after the cut
  }
  return out;
}

export interface Scene {
  start: number;
  end: number;
  features: FrameFeature[];
}

export function scenesFrom(features: FrameFeature[], cuts: number[], from: number, to: number): Scene[] {
  const bounds = [from, ...cuts, to];
  const scenes: Scene[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    if (e - s < 1e-3) continue;
    scenes.push({ start: s, end: e, features: features.filter((f) => f.t >= s - 1e-6 && f.t < e - 1e-6) });
  }
  return scenes;
}

/** Visual similarity of two scenes (0 = identical … 1): hashes compared at the same relative positions. */
export function sceneSimilarity(a: Scene, b: Scene): number {
  const n = Math.min(a.features.length, b.features.length);
  if (n < 2) return 1;
  let ham = 0;
  let hd = 0;
  for (let k = 0; k < n; k++) {
    const fa = a.features[Math.floor((k / n) * a.features.length)];
    const fb = b.features[Math.floor((k / n) * b.features.length)];
    ham += hamming(fa.hash, fb.hash) / 64;
    hd += histDistance(fa.hist, fb.hist);
  }
  return (ham / n) * 0.6 + (hd / n) * 0.4;
}

/** Runs of samples satisfying `pred` lasting at least `minLen` seconds (source time). */
export function runsWhere(features: FrameFeature[], step: number, pred: (f: FrameFeature) => boolean, minLen: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let s = -1;
  for (let i = 0; i <= features.length; i++) {
    const ok = i < features.length && pred(features[i]);
    if (ok && s < 0) s = i;
    if (!ok && s >= 0) {
      const start = features[s].t;
      const end = (i < features.length ? features[i].t : features[i - 1].t + step);
      if (end - start >= minLen) out.push({ start, end });
      s = -1;
    }
  }
  return out;
}

export interface SampleOptions {
  url: string;
  from: number;
  to: number;
  fps: number;
  signal: AbortSignal;
  onProgress: (f: number) => void;
}

/** Decodes frames at `fps` between from..to and returns their features. */
export async function sampleFeatures(o: SampleOptions): Promise<{ features: FrameFeature[]; refine: (a: number, b: number, frameRate: number) => Promise<number> }> {
  const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import('mediabunny');
  const blob = await (await fetch(o.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('This file has no video track.');
  const sink = new VideoSampleSink(track);
  const canvas = new OffscreenCanvas(FEATURE_W, FEATURE_H);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const read = async (ts: number[], cb: (t: number, rgba: Uint8ClampedArray) => void) => {
    for await (const s of sink.samplesAtTimestamps(ts)) {
      if (o.signal.aborted) {
        s?.close();
        throw new DOMException('Cancelled', 'AbortError');
      }
      if (!s) continue;
      g.drawImage(s.toCanvasImageSource(), 0, 0, FEATURE_W, FEATURE_H);
      cb(s.timestamp, g.getImageData(0, 0, FEATURE_W, FEATURE_H).data);
      s.close();
    }
  };
  const ts: number[] = [];
  for (let t = o.from; t < o.to - 1e-6; t += 1 / o.fps) ts.push(t);
  const features: FrameFeature[] = [];
  let prev: Float32Array | null = null;
  let lastTs = -1;
  let k = 0;
  await read(ts, (t, rgba) => {
    k++;
    if (k % 10 === 0) o.onProgress(k / ts.length);
    if (Math.abs(t - lastTs) < 1e-6 && features.length) {
      // The same source frame twice (sampling faster than the media): reuse.
      features.push({ ...features[features.length - 1], t: ts[features.length], motion: 0 });
      return;
    }
    lastTs = t;
    const r = frameFeature(ts[features.length], rgba, prev);
    prev = r.luma;
    features.push(r.f);
  });
  /** Exact cut time between two samples: the frame where the picture changes most. */
  const refine = async (a: number, b: number, frameRate: number): Promise<number> => {
    const fine: number[] = [];
    for (let t = a; t <= b + 1e-6; t += 1 / frameRate) fine.push(t);
    const frames: { t: number; f: FrameFeature }[] = [];
    let p: Float32Array | null = null;
    await read(fine, (t, rgba) => {
      const r = frameFeature(t, rgba, p);
      p = r.luma;
      frames.push({ t, f: r.f });
    });
    let best = b;
    let bestD = -1;
    for (let i = 1; i < frames.length; i++) {
      const d = frameChange(frames[i - 1].f, frames[i].f);
      if (d > bestD) {
        bestD = d;
        best = frames[i].t;
      }
    }
    return best;
  };
  return { features, refine };
}
