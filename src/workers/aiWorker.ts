/// <reference lib="webworker" />
// ---------------------------------------------------------------------------
// AI worker – runs the on-device models off the UI thread:
//  * transcribe – Whisper speech recognition (Transformers.js / ONNX Runtime
//                 Web, WebGPU when available, WebAssembly otherwise). The model
//                 is downloaded from the Hugging Face hub once and then served
//                 from the browser cache. Audio never leaves the machine.
//  * denoise    – RNNoise (a small recurrent neural network for speech noise
//                 suppression, compiled to WebAssembly, bundled with the app).
// Cancelling a job terminates the worker (the client creates a new one).
// ---------------------------------------------------------------------------

export type WhisperModel = 'tiny' | 'base' | 'small';

export interface TranscriptWindow {
  /** Seconds within the supplied audio. */
  start: number;
  end: number;
}

/** A recognised word (transcribe) or phrase (after grouping). */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export type AiWorkerRequest =
  | {
      id: number;
      type: 'transcribe';
      /** 16 kHz mono. */
      audio: Float32Array;
      windows: TranscriptWindow[];
      model: WhisperModel;
      /** 'auto': WebGPU when available (faster, larger download), else WebAssembly. */
      device: 'auto' | 'cpu';
      /** ISO code ('en', 'ur', …) or 'auto'. */
      language: string;
    }
  | { id: number; type: 'denoise'; channels: Float32Array[]; sampleRate: number; strength: number }
  | { id: number; type: 'limit'; channels: Float32Array[]; sampleRate: number; gainDb: number; ceilingDb: number };

export type AiWorkerResponse =
  | { id: number; kind: 'progress'; stage: 'download' | 'load' | 'process'; fraction: number; detail?: string }
  | { id: number; kind: 'segments'; segments: TranscriptSegment[] }
  | { id: number; kind: 'done'; segments?: TranscriptSegment[]; channels?: Float32Array[]; vad?: Float32Array; device?: string }
  | { id: number; kind: 'error'; error: string };

const post = (m: AiWorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

// "_timestamped" exports include the cross-attention outputs needed for
// word-level timestamps (same weights / size as the plain models).
const MODEL_IDS: Record<WhisperModel, string> = {
  tiny: 'onnx-community/whisper-tiny_timestamped',
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
};

// ---- Whisper -----------------------------------------------------------------------

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>;
let loaded: { key: string; run: Transcriber; device: string } | null = null;

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadWhisper(id: number, model: WhisperModel, pref: 'auto' | 'cpu') {
  const key = `${model}:${pref}`;
  if (loaded?.key === key) return loaded;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const webgpu = pref === 'auto' && (await hasWebGpu());
  // Download progress across all model files (bytes, aggregated).
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let l = 0;
      let t = 0;
      files.forEach((f) => ((l += f.loaded), (t += f.total)));
      post({ id, kind: 'progress', stage: 'download', fraction: t ? l / t : 0, detail: `${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB` });
    }
  };
  const create = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', MODEL_IDS[model], {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback,
    } as never);
  let run: unknown;
  let device = webgpu ? 'webgpu' : 'wasm';
  try {
    run = await create(device as 'webgpu' | 'wasm');
  } catch (e) {
    if (device !== 'webgpu') throw e;
    // WebGPU present but unusable (driver / limits): fall back to WebAssembly.
    device = 'wasm';
    files.clear();
    run = await create('wasm');
  }
  loaded = { key, run: run as Transcriber, device };
  return loaded;
}

async function transcribe(req: Extract<AiWorkerRequest, { type: 'transcribe' }>) {
  post({ id: req.id, kind: 'progress', stage: 'load', fraction: 0 });
  const w = await loadWhisper(req.id, req.model, req.device);
  const SR = 16000;
  const all: TranscriptSegment[] = [];
  const total = req.windows.reduce((s, x) => s + (x.end - x.start), 0) || 1;
  let done = 0;
  for (const win of req.windows) {
    const a = req.audio.subarray(Math.floor(win.start * SR), Math.ceil(win.end * SR));
    post({ id: req.id, kind: 'progress', stage: 'process', fraction: done / total, detail: w.device === 'webgpu' ? 'GPU' : 'CPU' });
    // Word-level timestamps: captions follow the voice word by word, even in fast,
    // continuous speech where Whisper's segment timestamps drift.
    const opts: Record<string, unknown> = { return_timestamps: 'word', task: 'transcribe' };
    if (req.language !== 'auto') opts.language = req.language;
    const out = (await w.run(a, opts)) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    const dur = win.end - win.start;
    const segs: TranscriptSegment[] = [];
    const chunks = out.chunks?.length ? out.chunks : [{ text: out.text, timestamp: [0, dur] as [number, number | null] }];
    for (const c of chunks) {
      const text = c.text.trim();
      if (!text) continue;
      const s = Math.max(0, Math.min(dur, c.timestamp[0] ?? 0));
      const e = Math.max(s + 0.02, Math.min(dur, c.timestamp[1] ?? s + 0.3));
      segs.push({ start: win.start + s, end: win.start + e, text });
    }
    all.push(...segs);
    done += dur;
    post({ id: req.id, kind: 'segments', segments: segs });
  }
  post({ id: req.id, kind: 'progress', stage: 'process', fraction: 1 });
  post({ id: req.id, kind: 'done', segments: all, device: w.device });
}

// ---- RNNoise -----------------------------------------------------------------------

async function denoise(req: Extract<AiWorkerRequest, { type: 'denoise' }>) {
  if (req.sampleRate !== 48000) throw new Error('RNNoise needs 48 kHz audio');
  post({ id: req.id, kind: 'progress', stage: 'load', fraction: 0 });
  const { Rnnoise } = await import('@shiguredo/rnnoise-wasm');
  const rn = await Rnnoise.load();
  const N = rn.frameSize; // 480 samples = 10 ms
  const len = req.channels[0].length;
  const frames = Math.ceil(len / N);
  const vad = new Float32Array(frames + 2);
  const out: Float32Array[] = [];
  const frame = new Float32Array(N);
  const totalWork = req.channels.length * (frames + 2);
  let work = 0;
  const k = Math.max(0, Math.min(1, req.strength));
  for (const dry of req.channels) {
    const st = rn.createDenoiseState();
    const wet = new Float32Array(len + 3 * N);
    // Two extra (silent) frames flush the network's 20 ms delay at the end.
    for (let f = 0; f < frames + 2; f++) {
      const off = f * N;
      frame.fill(0);
      for (let i = 0; i < N && off + i < len; i++) frame[i] = dry[off + i] * 32768;
      vad[f] = Math.max(vad[f], st.processFrame(frame));
      for (let i = 0; i < N; i++) wet[off + i] = frame[i] / 32768;
      if (++work % 2000 === 0) post({ id: req.id, kind: 'progress', stage: 'process', fraction: work / totalWork });
    }
    st.destroy();
    // RNNoise output lags its input by two frames (20 ms, measured by cross-
    // correlation): realign so the cleaned audio stays in sync with the picture,
    // then mix with the original (strength).
    const o = new Float32Array(len);
    for (let i = 0; i < len; i++) o[i] = wet[i + 2 * N] * k + dry[i] * (1 - k);
    out.push(o);
  }
  post({ id: req.id, kind: 'done', channels: out, vad }, [...out.map((c) => c.buffer), vad.buffer]);
}

/**
 * Gain + look-ahead peak limiter (offline, so no added delay): the gain needed
 * to keep every sample under the ceiling is spread over a 5 ms look-ahead
 * (attack) and released over 80 ms, linked across channels.
 */
function limit(req: Extract<AiWorkerRequest, { type: 'limit' }>) {
  const g = 10 ** (req.gainDb / 20);
  const ceil = 10 ** (req.ceilingDb / 20);
  const len = req.channels[0].length;
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let p = 0;
    for (const ch of req.channels) p = Math.max(p, Math.abs(ch[i] * g));
    need[i] = p > ceil ? ceil / p : 1;
  }
  const look = Math.max(1, Math.round(req.sampleRate * 0.005));
  const rel = Math.exp(-1 / (req.sampleRate * 0.08));
  // Running minimum over the look-ahead window (monotonic deque).
  const env = new Float32Array(len);
  const dq = new Int32Array(len);
  let h = 0;
  let t = 0;
  for (let i = 0, j = 0; i < len; i++) {
    for (; j < Math.min(len, i + look + 1); j++) {
      while (t > h && need[dq[t - 1]] >= need[j]) t--;
      dq[t++] = j;
    }
    while (dq[h] < i) h++;
    env[i] = need[dq[h]];
  }
  // Smooth: instant attack (already anticipated), exponential release.
  let cur = 1;
  for (let i = 0; i < len; i++) {
    cur = env[i] < cur ? env[i] : rel * cur + (1 - rel) * env[i];
    env[i] = Math.min(cur, env[i]);
  }
  const out = req.channels.map((ch) => {
    const o = new Float32Array(len);
    for (let i = 0; i < len; i++) o[i] = ch[i] * g * env[i];
    return o;
  });
  post({ id: req.id, kind: 'done', channels: out }, out.map((c) => c.buffer));
}

self.onmessage = async (e: MessageEvent<AiWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'transcribe') await transcribe(req);
    else if (req.type === 'denoise') await denoise(req);
    else if (req.type === 'limit') limit(req);
  } catch (err) {
    post({ id: req.id, kind: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
