import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { DEFAULT_MATTE, MATTE_MODEL_MB, matteEngine, type MatteModel } from '../../engine/ai/matte';
import { clipDuration, clipsOnTrack, isRangeFree } from '../../engine/timelineModel';
import { selectClips } from '../editingService';
import type { ClipMatte } from '../../types';
import { isRunning, runAiJob } from './aiJobs';

// ---------------------------------------------------------------------------
// AI background removal commands. The setting lives on the clip (saved with
// the project, undoable); the mask itself is computed per frame by the shared
// compositor, so preview and export always agree.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

/** Loads a segmentation model with progress in the AI jobs list. */
export function loadMatteModel(model: MatteModel) {
  if (matteEngine.isReady(model)) return Promise.resolve(true);
  // Already loading (e.g. started by enabling the setting): wait for the same load.
  if (isRunning('background') || matteEngine.statusOf(model) === 'loading') return matteEngine.load(model).then(() => true, () => false);
  return runAiJob('background', `Background model (${MATTE_MODEL_MB[model]} MB)`, async (ctl) => {
    ctl.progress('Downloading model', 0);
    await matteEngine.load(model, (f) => ctl.progress('Downloading model', f * 0.9));
    ctl.progress('Ready', 1);
    return true;
  }).then((r) => !!r);
}

export function setBackgroundRemoval(clipId: string, patch: Partial<ClipMatte>, coalesceKey?: string) {
  const clip = project().document.clips[clipId];
  if (!clip || clip.text) return;
  const next = { ...DEFAULT_MATTE, ...clip.matte, ...patch };
  project().updateClip(clipId, { matte: next }, coalesceKey);
  if (next.enabled) void loadMatteModel(next.model);
}

export function disableBackgroundRemoval(clipId: string) {
  const clip = project().document.clips[clipId];
  if (!clip?.matte) return;
  project().updateClip(clipId, { matte: { ...clip.matte, enabled: false } });
}

/**
 * Puts an image / video BEHIND a person clip as its new background: the
 * person moves to an overlay track if needed and the background media is
 * placed underneath for the same time range (cover-fitted). One undo step.
 */
export function putMediaBehind(clipId: string, mediaId: string): string | null {
  const subject = project().document.clips[clipId];
  const media = useMediaStore.getState().items.find((m) => m.id === mediaId && m.status === 'ready');
  if (!subject || !media || media.kind === 'audio') return null;
  let bgId: string | null = null;
  project().transaction(() => {
    let doc = project().document;
    const dur = clipDuration(subject);
    let subjectTrack = doc.tracks.find((t) => t.id === subject.trackId)!;
    // 1. The person must sit on an overlay track so something can go below it.
    if (subjectTrack.isMain || subjectTrack.type === 'video') {
      const free = doc.tracks.filter((t) => t.type === 'overlay' && !t.locked).reverse().find((t) => isRangeFree(clipsOnTrack(doc, t.id), subject.start, dur));
      const target = free?.id ?? project().addTrack('overlay');
      if (!project().moveClips([{ id: clipId, start: subject.start, trackId: target }])) return;
      doc = project().document;
      subjectTrack = doc.tracks.find((t) => t.id === target)!;
    }
    // 2. Background: the main track when free there, else a new overlay track moved below the person.
    const main = doc.tracks.find((t) => t.isMain);
    let bgTrack = main && !main.locked && isRangeFree(clipsOnTrack(doc, main.id), subject.start, dur) ? main.id : null;
    if (!bgTrack) {
      bgTrack = project().addTrack('overlay');
      for (let guard = 0; guard < 50; guard++) {
        const tracks = project().document.tracks;
        if (tracks.findIndex((t) => t.id === bgTrack) > tracks.findIndex((t) => t.id === subjectTrack.id)) break;
        if (!project().moveTrack(bgTrack, 1)) break;
      }
    }
    bgId = project().addClip(media, bgTrack, subject.start);
    if (!bgId) return;
    const len = media.kind === 'image' ? dur : Math.min(dur, media.duration ?? dur);
    project().setClipTiming(bgId, { start: subject.start, sourceIn: 0, sourceOut: len });
    project().updateClip(bgId, { fit: 'cover', name: `${media.name} (background)` });
  });
  if (bgId) {
    selectClips([clipId]);
    notify(`"${media.name}" placed behind the person.`, 'success');
  } else notify('Could not place the background (locked or full tracks).', 'warning');
  return bgId;
}
