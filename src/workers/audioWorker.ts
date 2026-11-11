/// <reference lib="webworker" />
// ---------------------------------------------------------------------------
// Audio DSP worker (keeps heavy loops off the UI thread):
//  * stretch – pitch-preserving time-stretch (WSOLA), used by the export so a
//              clip at 2× sounds like the preview (browsers preserve pitch).
//  * wav     – 16-bit PCM WAV encoding (extracted audio).
//  * peak    – absolute peak over a sample range (normalisation).
// ---------------------------------------------------------------------------

export type AudioWorkerRequest =
  | { id: number; type: 'stretch'; channels: Float32Array[]; factor: number }
  | { id: number; type: 'wav'; channels: Float32Array[]; sampleRate: number }
  | { id: number; type: 'peak'; channels: Float32Array[] };

export type AudioWorkerResponse =
  | { id: number; ok: true; channels?: Float32Array[]; wav?: ArrayBuffer; peak?: number }
  | { id: number; ok: false; error: string };

/**
 * WSOLA time-stretch. `factor` = playback speed: output length = input / factor.
 * Frames of N samples are overlap-added at a fixed synthesis hop; each frame's
 * input position is nudged (±tolerance) to the offset that best continues the
 * previous frame (cross-correlation on a decimated mono mix), which preserves pitch.
 */
function wsola(channels: Float32Array[], factor: number): Float32Array[] {
  const N = 2048;
  const Hs = N / 4;
  const Ha = Hs * factor;
  const tol = 384;
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen / factor));
  const out = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;

  let prevPos = 0;
  const frames = Math.ceil(outLen / Hs) + 1;
  for (let k = 0; k < frames; k++) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // Natural continuation of the previous frame starts at prevPos + Hs.
      const ref = prevPos + Hs;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const cand = nominal + d;
        if (cand < 0 || cand + N / 2 >= inLen) continue;
        let score = 0;
        for (let i = 0; i < N / 2; i += 4) {
          const a = ref + i < inLen ? mono[ref + i] : 0;
          score += a * mono[cand + i];
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    best = Math.max(0, Math.min(inLen - 1, best));
    const o = k * Hs;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < N && o + i < dst.length; i++) {
        const v = best + i < inLen ? src[best + i] : 0;
        dst[o + i] += v * win[i];
      }
    }
    for (let i = 0; i < N && o + i < norm.length; i++) norm[o + i] += win[i];
    prevPos = best;
  }
  return out.map((ch) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : 0;
    return r;
  });
}

function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const n = channels[0]?.length ?? 0;
  const nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

function peakOf(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > p) p = a;
  }
  return p;
}

self.onmessage = (e: MessageEvent<AudioWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'stretch') {
      const channels = wsola(req.channels, req.factor);
      (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: true, channels } satisfies AudioWorkerResponse, channels.map((c) => c.buffer));
    } else if (req.type === 'wav') {
      const wav = encodeWav(req.channels, req.sampleRate);
      (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: true, wav } satisfies AudioWorkerResponse, [wav]);
    } else {
      (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: true, peak: peakOf(req.channels) } satisfies AudioWorkerResponse);
    }
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies AudioWorkerResponse);
  }
};
