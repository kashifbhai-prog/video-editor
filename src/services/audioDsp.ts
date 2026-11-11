import type { AudioWorkerRequest, AudioWorkerResponse } from '../workers/audioWorker';

// ---------------------------------------------------------------------------
// Promise API over the audio DSP worker + decoded-audio cache.
// ---------------------------------------------------------------------------

type Pending = { resolve: (r: Extract<AudioWorkerResponse, { ok: true }>) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/audioWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AudioWorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(e.message || 'Audio worker failed')));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

type Req = AudioWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function call(req: Req, transfer: Transferable[] = []): Promise<Extract<AudioWorkerResponse, { ok: true }>> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id }, transfer);
  });
}

const copyChannels = (b: AudioBuffer, from = 0, to = b.length) =>
  Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice(from, to));

/** Pitch-preserving time-stretch of a buffer (speed > 1 = shorter). */
export async function timeStretch(ctx: BaseAudioContext, buf: AudioBuffer, speed: number): Promise<AudioBuffer> {
  if (Math.abs(speed - 1) < 1e-6) return buf;
  const channels = copyChannels(buf);
  const r = await call({ type: 'stretch', channels, factor: speed }, channels.map((c) => c.buffer));
  const out = ctx.createBuffer(buf.numberOfChannels, r.channels![0].length, buf.sampleRate);
  r.channels!.forEach((ch, i) => out.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return out;
}

export async function encodeWav(buf: AudioBuffer, from = 0, to = buf.length): Promise<ArrayBuffer> {
  const channels = copyChannels(buf, from, to);
  const r = await call({ type: 'wav', channels, sampleRate: buf.sampleRate }, channels.map((c) => c.buffer));
  return r.wav!;
}

export async function peakOf(buf: AudioBuffer, from = 0, to = buf.length): Promise<number> {
  const channels = copyChannels(buf, from, to);
  const r = await call({ type: 'peak', channels }, channels.map((c) => c.buffer));
  return r.peak!;
}

// ---- Decoded audio cache ---------------------------------------------------------------

const decoded = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Decodes the audio of a media file (audio or video container) at 48 kHz.
 * Resolves null when the file has no decodable audio track. Cached per URL.
 */
export function decodeMediaAudio(url: string): Promise<AudioBuffer | null> {
  let p = decoded.get(url);
  if (!p) {
    p = (async () => {
      try {
        const bytes = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(2, 1, 48000);
        return await ctx.decodeAudioData(bytes);
      } catch {
        return null;
      }
    })();
    decoded.set(url, p);
    // Keep the cache small: decoded PCM is large (≈ 23 MB per stereo minute).
    if (decoded.size > 6) decoded.delete(decoded.keys().next().value!);
  }
  return p;
}

export function forgetDecodedAudio(url: string) {
  decoded.delete(url);
}
