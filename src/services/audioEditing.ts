import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import { clipAudio, DEFAULT_CLIP_AUDIO, gainToDb } from '../engine/audio';
import { clipDuration, clipsOnTrack, isRangeFree } from '../engine/timelineModel';
import { decodeMediaAudio, encodeWav, peakOf } from './audioDsp';
import { selectClips } from './editingService';
import type { Clip, ClipAudio, MediaItem } from '../types';

// ---------------------------------------------------------------------------
// Audio editing commands: per-clip processing, normalisation, extracting a
// video's audio into its own clip. All edits are undoable store commits.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

export function setClipAudio(clipId: string, patch: Partial<ClipAudio>, coalesceKey?: string) {
  const clip = project().document.clips[clipId];
  if (!clip) return;
  project().updateClip(clipId, { audio: { ...clipAudio(clip), ...patch } }, coalesceKey);
}

export function resetClipAudio(clipId: string) {
  project().updateClip(clipId, { audio: { ...DEFAULT_CLIP_AUDIO, eq: [0, 0, 0, 0, 0] } });
}

const mediaOf = (clip: Clip): MediaItem | undefined => useMediaStore.getState().items.find((m) => m.id === clip.mediaId);

/**
 * Normalises a clip: measures the peak of its source range and sets the clip
 * gain so that peak reaches -1 dBFS. Returns the applied gain (dB) or null.
 */
export async function normalizeClip(clipId: string, targetDb = -1): Promise<number | null> {
  const clip = project().document.clips[clipId];
  const media = clip && mediaOf(clip);
  if (!clip || !media) return null;
  const buf = await decodeMediaAudio(media.url);
  if (!buf) {
    notify('This clip has no audio to normalise.', 'warning');
    return null;
  }
  const from = Math.max(0, Math.floor(clip.sourceIn * buf.sampleRate));
  const to = Math.min(buf.length, Math.ceil(clip.sourceOut * buf.sampleRate));
  const peak = await peakOf(buf, from, to);
  if (peak < 1e-5) {
    notify('The clip is silent – nothing to normalise.', 'warning');
    return null;
  }
  const gainDb = Math.round(Math.min(24, Math.max(-24, targetDb - gainToDb(peak))) * 10) / 10;
  setClipAudio(clipId, { gainDb });
  notify(`Normalised: peak ${gainToDb(peak).toFixed(1)} dBFS → ${targetDb} dBFS (gain ${gainDb > 0 ? '+' : ''}${gainDb} dB).`, 'success');
  return gainDb;
}

/**
 * Extracts a video clip's audio into a new audio clip (a WAV file in the media
 * library) at the same timeline position and source range, then silences the
 * video clip's own audio. One undo step for the timeline change.
 */
export async function extractAudio(clipId: string): Promise<string | null> {
  const clip = project().document.clips[clipId];
  const media = clip && mediaOf(clip);
  if (!clip || !media || media.kind !== 'video') return null;
  const buf = await decodeMediaAudio(media.url);
  if (!buf) {
    notify(`"${media.name}" has no audio track to extract.`, 'warning');
    return null;
  }
  const base = media.name.replace(/\.[^.]+$/, '');
  const fileName = `${base} (audio).wav`;
  const store = useMediaStore.getState();
  let audioMedia = store.items.find((m) => m.name === fileName && m.status === 'ready');
  if (!audioMedia) {
    // Whole file, so the new clip keeps the same trim handles as the video clip.
    const wav = await encodeWav(buf);
    await store.importFiles([new File([wav], fileName, { type: 'audio/wav' })]);
    const matches = useMediaStore.getState().items.filter((m) => m.name === fileName && m.status === 'ready');
    audioMedia = matches[matches.length - 1];
  }
  if (!audioMedia) {
    notify('The extracted audio could not be imported.', 'error');
    return null;
  }
  const current = project().document.clips[clipId];
  if (!current) return null;
  let newId: string | null = null;
  project().transaction(() => {
    const doc = project().document;
    const dur = clipDuration(current);
    const free = doc.tracks.find((t) => t.type === 'audio' && !t.locked && isRangeFree(clipsOnTrack(doc, t.id), current.start, dur));
    const trackId = free?.id ?? project().addTrack('audio');
    newId = project().addClip(audioMedia!, trackId, current.start);
    if (!newId) return;
    const kf = current.keyframes?.volume;
    project().updateClip(newId, {
      speed: current.speed,
      volume: current.volume,
      audio: current.audio,
      name: `${current.name} (audio)`,
      keyframes: kf ? { volume: kf } : undefined,
    });
    // addClip placed it at the start; apply the exact range (updateClip does not move timing fields).
    project().setClipTiming(newId, { start: current.start, sourceIn: current.sourceIn, sourceOut: current.sourceOut });
    const keyframes = { ...current.keyframes };
    delete keyframes.volume;
    project().updateClip(clipId, { volume: 0, keyframes });
  });
  if (newId) {
    selectClips([newId]);
    notify('Audio extracted to its own clip; the video clip was muted.', 'success');
  }
  return newId;
}
