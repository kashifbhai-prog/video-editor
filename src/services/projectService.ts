import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import type { SavedProject } from '../types';
import { loadExportSettings, useExportStore } from './exportService';
import { downloadFile, mediaStorage, projectStorage, type StoredMediaRecord } from '../utils/storage';

type StoredMediaRecordList = StoredMediaRecord[];

// ---------------------------------------------------------------------------
// Project-level operations that coordinate several stores + storage.
// ---------------------------------------------------------------------------

function buildSavedProject(): SavedProject {
  const p = useProjectStore.getState();
  const media = useMediaStore.getState().items;
  return {
    version: 1,
    id: p.projectId,
    createdAt: p.createdAt,
    savedAt: Date.now(),
    document: p.document,
    mediaIds: media.filter((m) => m.status === 'ready' && m.persisted).map((m) => m.id),
    exportSettings: useExportStore.getState().settings ?? undefined,
  };
}

export async function saveProject(opts: { silent?: boolean } = {}): Promise<boolean> {
  const { notify } = useUiStore.getState();
  if (useMediaStore.getState().importing > 0) {
    if (!opts.silent) notify('Please wait for media imports to finish before saving.', 'warning');
    return false;
  }
  const project = buildSavedProject();
  try {
    projectStorage.save(project);
    useProjectStore.getState().markSaved(project.savedAt);
    // Remove blobs of media that are no longer part of the project.
    mediaStorage.deleteAllExcept(new Set(project.mediaIds)).catch(() => undefined);
    const notPersisted = useMediaStore.getState().items.filter((m) => !m.persisted).length;
    if (!opts.silent) {
      notify(
        notPersisted
          ? `Project saved. ${notPersisted} media file(s) could not be stored and won't be restored.`
          : 'Project saved.',
        notPersisted ? 'warning' : 'success',
      );
    }
    return true;
  } catch (err) {
    notify(`Save failed: ${err instanceof Error ? err.message : 'storage unavailable'}`, 'error');
    return false;
  }
}

/** Restores the last saved project (metadata + stored media). Returns true if a project was found. */
export async function restoreProject(): Promise<boolean> {
  const saved = projectStorage.load();
  if (!saved) {
    // No project: drop any orphaned blobs from unsaved sessions.
    mediaStorage.clear().catch(() => undefined);
    return false;
  }
  useProjectStore.getState().loadProject({
    id: saved.id,
    createdAt: saved.createdAt,
    savedAt: saved.savedAt,
    document: saved.document,
  });
  loadExportSettings(saved.exportSettings);

  const records: StoredMediaRecordList = [];
  let missing = 0;
  try {
    for (const id of saved.mediaIds) {
      const rec = await mediaStorage.get(id);
      if (rec) records.push(rec);
      else missing++;
    }
    await mediaStorage.deleteAllExcept(new Set(saved.mediaIds));
  } catch {
    missing = saved.mediaIds.length - records.length;
  }
  useMediaStore.getState().restoreFromRecords(records);

  const { notify, setPreviewMedia } = useUiStore.getState();
  // Show the edited timeline when there is one; otherwise preview a source.
  const hasClips = Object.keys(useProjectStore.getState().document.clips).length > 0;
  const firstVisual = records.find((r) => r.meta.kind === 'video') ?? records[0];
  if (!hasClips && firstVisual) setPreviewMedia(firstVisual.id);
  notify(
    missing
      ? `Restored "${saved.document.name}". ${missing} media file(s) were unavailable.`
      : `Restored "${saved.document.name}".`,
    missing ? 'warning' : 'info',
  );
  return true;
}

/** Starts a fresh project and removes the saved one. */
export async function resetProject() {
  projectStorage.clear();
  await mediaStorage.clear().catch(() => undefined);
  useMediaStore.getState().clearAll();
  useProjectStore.getState().resetProject();
  loadExportSettings(undefined);
  const ui = useUiStore.getState();
  ui.setPreviewMedia(null);
  ui.setSelection({ kind: 'none' });
  ui.notify('Started a new project.', 'info');
}

/** Downloads the project description (settings, tracks, media list) as JSON. */
export function exportProjectFile() {
  const project = buildSavedProject();
  const media = useMediaStore.getState().items.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    mimeType: m.mimeType,
    size: m.size,
    duration: m.duration,
    width: m.width,
    height: m.height,
  }));
  const safeName = project.document.name.replace(/[^\w\- ]+/g, '').trim() || 'project';
  downloadFile(`${safeName}.reelforge.json`, JSON.stringify({ ...project, media }, null, 2));
}
