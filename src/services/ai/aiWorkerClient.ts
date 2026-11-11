import type { AiWorkerRequest, AiWorkerResponse, TranscriptSegment, TranscriptWindow, WhisperModel } from '../../workers/aiWorker';
import { CancelledError, type JobControl } from './aiJobs';

// ---------------------------------------------------------------------------
// Promise API over the AI worker. Cancelling terminates the worker (models
// stay in the browser cache, so the next job only pays the load time).
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../../workers/aiWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

type Req = AiWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
type Done = Extract<AiWorkerResponse, { kind: 'done' }>;

const STAGE_LABEL = { download: 'Downloading model', load: 'Loading model', process: 'Processing' } as const;

function call(req: Req, ctl: JobControl, map: (stage: keyof typeof STAGE_LABEL, f: number, detail?: string) => void, onSegments?: (s: TranscriptSegment[]) => void, transfer: Transferable[] = []): Promise<Done> {
  return new Promise((resolve, reject) => {
    if (ctl.signal.aborted) return reject(new CancelledError());
    const w = getWorker();
    const id = nextId++;
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      ctl.signal.removeEventListener('abort', onAbort);
    };
    const onMsg = (e: MessageEvent<AiWorkerResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.kind === 'progress') map(m.stage, m.fraction, m.detail);
      else if (m.kind === 'segments') onSegments?.(m.segments);
      else if (m.kind === 'done') {
        cleanup();
        resolve(m);
      } else if (m.kind === 'error') {
        cleanup();
        reject(new Error(m.error));
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The AI worker crashed (possibly out of memory).'));
    };
    const onAbort = () => {
      cleanup();
      worker?.terminate();
      worker = null;
      reject(new CancelledError());
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    ctl.signal.addEventListener('abort', onAbort);
    w.postMessage({ ...req, id }, transfer);
  });
}

export async function transcribeAudio(
  audio16k: Float32Array,
  windows: TranscriptWindow[],
  model: WhisperModel,
  language: string,
  device: 'auto' | 'cpu',
  ctl: JobControl,
  range: [number, number],
  onSegments?: (s: TranscriptSegment[]) => void,
): Promise<{ segments: TranscriptSegment[]; device: string }> {
  const [lo, hi] = range;
  const r = await call(
    { type: 'transcribe', audio: audio16k, windows, model, language, device },
    ctl,
    (stage, f, detail) => {
      if (stage === 'download') ctl.progress(STAGE_LABEL.download, lo + f * (hi - lo) * 0.3, detail);
      else if (stage === 'load') ctl.progress(STAGE_LABEL.load, lo + (hi - lo) * 0.3, detail);
      else ctl.progress(`Transcribing${detail ? ` (${detail})` : ''}`, lo + (hi - lo) * (0.3 + 0.7 * f));
    },
    onSegments,
  );
  return { segments: r.segments ?? [], device: r.device ?? 'wasm' };
}

export async function denoiseAudio(channels: Float32Array[], sampleRate: number, strength: number, ctl: JobControl, range: [number, number]) {
  const [lo, hi] = range;
  const r = await call(
    { type: 'denoise', channels, sampleRate, strength },
    ctl,
    (stage, f) => ctl.progress(stage === 'process' ? 'Removing noise (RNNoise)' : 'Loading noise model', lo + f * (hi - lo)),
    undefined,
    channels.map((c) => c.buffer),
  );
  return { channels: r.channels!, vad: r.vad! };
}

export type { WhisperModel, TranscriptSegment };

/** Gain + look-ahead peak limiter (offline, no added delay). */
export async function limitAudio(channels: Float32Array[], sampleRate: number, gainDb: number, ceilingDb: number, ctl: JobControl) {
  const r = await call({ type: 'limit', channels, sampleRate, gainDb, ceilingDb }, ctl, () => {}, undefined, channels.map((c) => c.buffer));
  return r.channels!;
}
