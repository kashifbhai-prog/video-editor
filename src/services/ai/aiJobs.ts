import { create } from 'zustand';
import { useUiStore } from '../../store/uiStore';

// ---------------------------------------------------------------------------
// AI job tracking: one consistent progress / cancel / error experience for
// every AI operation. Jobs run asynchronously (workers, GPU, offline audio) so
// the editor stays usable; each kind runs at most once at a time.
// ---------------------------------------------------------------------------

export type AiJobKind = 'captions' | 'silence' | 'enhance' | 'scenes' | 'background' | 'summary';

export interface AiJob {
  id: number;
  kind: AiJobKind;
  label: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  stage: string;
  /** 0..1 */
  progress: number;
  detail?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface JobControl {
  signal: AbortSignal;
  progress: (stage: string, fraction: number, detail?: string) => void;
}

interface AiJobsState {
  jobs: AiJob[];
}

export const useAiJobs = create<AiJobsState>()(() => ({ jobs: [] }));

const controllers = new Map<number, AbortController>();
let nextId = 1;

const patch = (id: number, p: Partial<AiJob>) =>
  useAiJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export const isRunning = (kind: AiJobKind) => useAiJobs.getState().jobs.some((j) => j.kind === kind && j.status === 'running');

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new CancelledError();
}

/** Turns technical failures into a message the user can act on. */
export function friendlyAiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to load|NetworkError|ERR_INTERNET|404|503/i.test(msg))
    return 'Could not download the AI model. Check the internet connection (models are downloaded once, then work offline).';
  if (/out of memory|OOM|allocation|Aborted\(\)/i.test(msg)) return 'Not enough memory for this AI task. Try a shorter clip or the smaller model.';
  if (/webgpu|adapter/i.test(msg)) return 'The graphics card could not run the model. It will retry on the CPU next time.';
  return msg || 'The AI task failed.';
}

/**
 * Runs an AI job with progress + cancel. Returns the result, or null when the
 * job was cancelled or failed (the failure is reported to the user).
 */
export async function runAiJob<T>(kind: AiJobKind, label: string, fn: (ctl: JobControl) => Promise<T>): Promise<T | null> {
  if (isRunning(kind)) {
    useUiStore.getState().notify(`${label} is already running.`, 'warning');
    return null;
  }
  const id = nextId++;
  const ac = new AbortController();
  controllers.set(id, ac);
  useAiJobs.setState((s) => ({
    jobs: [{ id, kind, label, status: 'running' as const, stage: 'Starting…', progress: 0, startedAt: Date.now() }, ...s.jobs.filter((j) => j.kind !== kind)].slice(0, 8),
  }));
  let last = 0;
  const ctl: JobControl = {
    signal: ac.signal,
    progress: (stage, fraction, detail) => {
      const now = performance.now();
      // Throttle store updates (~15 / s) so progress never costs UI frames.
      if (now - last < 66 && fraction < 1) return;
      last = now;
      patch(id, { stage, progress: Math.max(0, Math.min(1, fraction)), detail });
    },
  };
  try {
    const r = await fn(ctl);
    throwIfAborted(ac.signal);
    patch(id, { status: 'done', progress: 1, stage: 'Done', finishedAt: Date.now() });
    return r;
  } catch (e) {
    if (e instanceof CancelledError || ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      patch(id, { status: 'cancelled', stage: 'Cancelled', finishedAt: Date.now() });
      return null;
    }
    console.warn(`[ai] ${kind} failed`, e);
    const error = friendlyAiError(e);
    patch(id, { status: 'error', stage: 'Failed', error, finishedAt: Date.now() });
    useUiStore.getState().notify(`${label} failed: ${error}`, 'error');
    return null;
  } finally {
    controllers.delete(id);
  }
}

export function cancelAiJob(id: number) {
  controllers.get(id)?.abort();
}

export function dismissAiJob(id: number) {
  useAiJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id || j.status === 'running') }));
}
