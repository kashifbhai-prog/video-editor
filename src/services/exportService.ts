import { create } from 'zustand';
import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { previewEngine } from '../engine/previewEngine';
import type { ExportCapabilities } from '../engine/export/capabilities';
import { defaultExportSettings } from '../engine/export/exportSettings';
import type { ExportProgress, ExportResult } from '../engine/export/exporter';
import { track } from './analytics';
import type { ExportSettings } from '../types';

// ---------------------------------------------------------------------------
// Export job state + controller. The rendered file lives only as a Blob /
// object URL here (never in the project document or storage); the URL is
// revoked when the result is dismissed or replaced.
// ---------------------------------------------------------------------------

export type ExportStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

interface ExportState {
  settings: ExportSettings | null;
  capabilities: ExportCapabilities | null;
  probing: boolean;
  status: ExportStatus;
  progress: ExportProgress | null;
  startedAt: number;
  error: string | null;
  result: (ExportResult & { url: string }) | null;
}

export const useExportStore = create<ExportState>()(() => ({
  settings: null,
  capabilities: null,
  probing: false,
  status: 'idle',
  progress: null,
  startedAt: 0,
  error: null,
  result: null,
}));

let controller: AbortController | null = null;

export function getExportSettings(): ExportSettings {
  const s = useExportStore.getState().settings;
  if (s) return s;
  const { document: doc } = useProjectStore.getState();
  const d = defaultExportSettings(doc.name, doc.canvas.frameRate, doc.canvas.aspectRatio);
  useExportStore.setState({ settings: d });
  return d;
}

export function setExportSettings(patch: Partial<ExportSettings>) {
  useExportStore.setState({ settings: { ...getExportSettings(), ...patch } });
  useProjectStore.getState().markDirty();
}

/** Restores settings saved with a project (or resets to defaults for a new project). */
export function loadExportSettings(s: ExportSettings | undefined) {
  useExportStore.setState({ settings: s ?? null });
}

export async function refreshCapabilities() {
  const { document: doc } = useProjectStore.getState();
  useExportStore.setState({ probing: true });
  try {
    // The export engine (Mediabunny + encoders) is loaded on demand to keep the editor bundle small.
    const { probeExportCapabilities } = await import('../engine/export/capabilities');
    const capabilities = await probeExportCapabilities(doc.canvas.aspectRatio, getExportSettings().frameRate);
    useExportStore.setState({ capabilities });
  } finally {
    useExportStore.setState({ probing: false });
  }
}

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

export async function startExport() {
  const st = useExportStore.getState();
  if (st.status === 'running') return;
  clearExportResult();
  const settings = getExportSettings();
  const audioCodec = st.capabilities?.audioCodec ?? null;
  previewEngine.pause();
  controller = new AbortController();
  useExportStore.setState({ status: 'running', error: null, progress: { stage: 'prepare', progress: 0, frame: 0, frames: 0 }, startedAt: performance.now() });
  window.addEventListener('beforeunload', onBeforeUnload);
  try {
    const { runExport } = await import('../engine/export/exporter');
    const result = await runExport({
      doc: useProjectStore.getState().document,
      media: useMediaStore.getState().items,
      settings,
      signal: controller.signal,
      audioCodec,
      onProgress: (progress) => useExportStore.setState({ progress }),
    });
    useExportStore.setState({ status: 'done', result: { ...result, url: URL.createObjectURL(result.blob) } });
    track('export_complete', { resolution: `${result.width}x${result.height}`, fps: result.frameRate, codec: result.videoCodec, seconds: Math.round(result.duration) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') useExportStore.setState({ status: 'cancelled' });
    else useExportStore.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    controller = null;
    window.removeEventListener('beforeunload', onBeforeUnload);
  }
}

export function cancelExport() {
  controller?.abort();
}

/** Releases the rendered file (object URL + blob). */
export function clearExportResult() {
  const r = useExportStore.getState().result;
  if (r) URL.revokeObjectURL(r.url);
  useExportStore.setState({ result: null, status: useExportStore.getState().status === 'running' ? 'running' : 'idle', error: null, progress: null });
}
