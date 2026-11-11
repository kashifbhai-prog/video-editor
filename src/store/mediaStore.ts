import { create } from 'zustand';
import type { MediaItem, PersistedMediaMeta } from '../types';
import { createId } from '../utils/id';
import { validateMediaFile } from '../utils/mediaValidation';
import { probeMedia } from '../utils/mediaProbe';
import { mediaStorage, type StoredMediaRecord } from '../utils/storage';
import { useUiStore } from './uiStore';
import { useProjectStore } from './projectStore';
import { track } from '../services/analytics';
import { releaseFilmstrip } from '../services/filmstrip';

// ---------------------------------------------------------------------------
// Media store: the project's media library. Owns object-URL lifetimes and
// mirrors imported blobs into IndexedDB so projects can be restored.
// ---------------------------------------------------------------------------

const PROBE_CONCURRENCY = 4;

function toMeta(item: MediaItem): PersistedMediaMeta {
  const { url: _url, status: _s, error: _e, persisted: _p, ...meta } = item;
  return meta;
}

interface MediaState {
  items: MediaItem[];
  importing: number;

  importFiles: (files: File[] | FileList) => Promise<void>;
  removeMedia: (id: string) => void;
  restoreFromRecords: (records: StoredMediaRecord[]) => void;
  clearAll: () => void;
  getById: (id: string) => MediaItem | undefined;
}

export const useMediaStore = create<MediaState>()((set, get) => {
  const patch = (id: string, p: Partial<MediaItem>) =>
    set((s) => ({ items: s.items.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  return {
    items: [],
    importing: 0,

    importFiles: async (fileList) => {
      const files = Array.from(fileList);
      const { notify } = useUiStore.getState();
      if (!files.length) return;

      const accepted: { file: File; item: MediaItem }[] = [];
      const rejected: string[] = [];

      for (const file of files) {
        const result = validateMediaFile(file);
        if (!result.ok) {
          rejected.push(result.reason);
          continue;
        }
        accepted.push({
          file,
          item: {
            id: createId('med'),
            name: file.name,
            kind: result.kind,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            url: URL.createObjectURL(file),
            status: 'processing',
            persisted: false,
            importedAt: Date.now(),
          },
        });
      }

      if (rejected.length === 1) notify(rejected[0], 'error');
      else if (rejected.length > 1)
        notify(`${rejected.length} files were skipped (unsupported type or invalid file).`, 'error');

      if (!accepted.length) return;

      set((s) => ({
        items: [...s.items, ...accepted.map((a) => a.item)],
        importing: s.importing + accepted.length,
      }));
      useProjectStore.getState().markDirty();

      let ok = 0;
      const stillPresent = (id: string) => get().items.some((m) => m.id === id);

      const processOne = async ({ file, item }: (typeof accepted)[number]) => {
        try {
          // The user may remove an item while it is still queued.
          if (!stillPresent(item.id)) return;
          const probe = await probeMedia(item.kind, file, item.url);
          if (!stillPresent(item.id)) return;
          const ready: MediaItem = { ...item, ...probe, status: 'ready' };
          patch(item.id, { ...probe, status: 'ready' });
          ok++;
          // Persist blob so the project can be restored after a reload.
          try {
            await mediaStorage.put({ id: item.id, meta: toMeta(ready), blob: file });
            if (stillPresent(item.id)) patch(item.id, { persisted: true });
          } catch {
            notify(
              `"${item.name}" was imported but could not be stored locally (storage quota). It won't be restored after reload.`,
              'warning',
            );
          }
        } catch (err) {
          if (!stillPresent(item.id)) return; // removed mid-import: not an error
          const message = err instanceof Error ? err.message : 'Failed to read file.';
          patch(item.id, { status: 'error', error: message });
          notify(`Could not import "${item.name}": ${message}`, 'error');
        } finally {
          set((s) => ({ importing: s.importing - 1 }));
          // removeMedia defers revocation of in-flight items to here.
          if (!stillPresent(item.id)) URL.revokeObjectURL(item.url);
        }
      };

      // Bounded concurrency: each probe creates a decoder, and browsers cap the
      // number of simultaneous media players.
      const queue = [...accepted];
      const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await processOne(next);
      });
      await Promise.all(workers);

      if (ok > 0) notify(`Imported ${ok} file${ok === 1 ? '' : 's'}.`, 'success');
      if (ok > 0) track('media_import', { files: ok });

      // Auto-preview the first imported item, but only while the timeline is
      // still empty – never interrupt an edit in progress.
      const ui = useUiStore.getState();
      const timelineEmpty = Object.keys(useProjectStore.getState().document.clips).length === 0;
      if (!ui.previewMediaId && timelineEmpty) {
        const first = get().items.find(
          (m) => accepted.some((a) => a.item.id === m.id) && m.status === 'ready',
        );
        if (first) ui.setPreviewMedia(first.id);
      }
    },

    removeMedia: (id) => {
      const item = get().items.find((m) => m.id === id);
      if (!item) return;
      // An item still being probed is revoked by the import worker once it finishes,
      // otherwise the probe would fail reading a revoked URL.
      if (item.status !== 'processing') URL.revokeObjectURL(item.url);
      set((s) => ({ items: s.items.filter((m) => m.id !== id) }));
      const ui = useUiStore.getState();
      if (ui.previewMediaId === id) ui.setPreviewMedia(null);
      if (ui.selection.kind === 'media' && ui.selection.id === id) ui.setSelection({ kind: 'none' });
      // Timeline clips that use this media go with it (one undoable step).
      useProjectStore.getState().removeClipsForMedia(id);
      releaseFilmstrip(id);
      useProjectStore.getState().markDirty();
      // The blob is garbage-collected from IndexedDB on the next save.
    },

    restoreFromRecords: (records) => {
      get().items.forEach((m) => URL.revokeObjectURL(m.url));
      set({
        items: records.map((r) => ({
          ...r.meta,
          url: URL.createObjectURL(r.blob),
          status: 'ready',
          persisted: true,
        })),
      });
    },

    clearAll: () => {
      get().items.forEach((m) => {
        URL.revokeObjectURL(m.url);
        releaseFilmstrip(m.id);
      });
      set({ items: [] });
    },

    getById: (id) => get().items.find((m) => m.id === id),
  };
});
