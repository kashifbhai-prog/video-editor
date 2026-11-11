import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { detectSilences, levelEnvelope, levelStats, type SilenceOptions } from '../../engine/ai/audioAnalysis';
import { removeTimeRanges, type TimeRange } from '../../engine/rippleEdit';
import { createId } from '../../utils/id';
import type { Clip } from '../../types';
import { runAiJob } from './aiJobs';
import { renderTimelineAudio } from './timelineAudio';
import { track } from '../analytics';
import { isFresh, useAiResults, type SilenceRange } from './aiStore';

// ---------------------------------------------------------------------------
// Silence detection & removal. Pauses are found in the timeline mix (what the
// export will contain), shown on the timeline for review, and removed with a
// ripple edit across all unlocked tracks – one undo step.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

export const DEFAULT_SILENCE: Omit<SilenceOptions, 'threshold'> & { threshold: number | 'auto' } = {
  threshold: 'auto',
  minDuration: 0.6,
  padding: 0.12,
};

/** Level envelope of the last analysis (re-filtering with new settings needs no re-render). */
let lastEnv: { env: Float32Array; duration: number } | null = null;

function applyOptions(o: typeof DEFAULT_SILENCE) {
  const cur = useAiResults.getState().silence;
  if (!lastEnv || !cur) return;
  const stats = levelStats(lastEnv.env);
  const threshold = o.threshold === 'auto' ? stats.threshold : o.threshold;
  const ranges = detectSilences(lastEnv.env, { threshold, minDuration: o.minDuration, padding: o.padding }, lastEnv.duration);
  useAiResults.setState({ silence: { ...cur, ranges: ranges.map((r) => ({ ...r, selected: true })), threshold } });
}

export async function detectTimelineSilence(o: typeof DEFAULT_SILENCE = DEFAULT_SILENCE): Promise<SilenceRange[] | null> {
  const doc = project().document;
  return runAiJob('silence', 'Silence detection', async (ctl) => {
    const audio = await renderTimelineAudio({ sampleRate: 16000 }, ctl, [0, 0.85]);
    if (!audio) throw new Error('There is no audible audio on the timeline (check muted tracks).');
    ctl.progress('Measuring levels', 0.9);
    const env = levelEnvelope(audio.mono, audio.sampleRate);
    const stats = levelStats(env);
    lastEnv = { env, duration: audio.duration };
    useAiResults.setState({ silence: { doc, ranges: [], threshold: stats.threshold, floor: stats.floor, speech: stats.speech } });
    applyOptions(o);
    const ranges = useAiResults.getState().silence?.ranges ?? [];
    const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
    notify(ranges.length ? `Found ${ranges.length} pauses (${total.toFixed(1)} s). Review them on the timeline.` : 'No pauses longer than the minimum were found.', ranges.length ? 'success' : 'info');
    return ranges;
  });
}

/** Re-applies threshold / length / padding to the last analysis instantly. */
export function updateSilenceOptions(o: typeof DEFAULT_SILENCE) {
  applyOptions(o);
}

export function toggleSilence(index: number) {
  const cur = useAiResults.getState().silence;
  if (!cur) return;
  useAiResults.setState({ silence: { ...cur, ranges: cur.ranges.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)) } });
}

export function selectAllSilences(selected: boolean) {
  const cur = useAiResults.getState().silence;
  if (!cur) return;
  useAiResults.setState({ silence: { ...cur, ranges: cur.ranges.map((r) => ({ ...r, selected })) } });
}

export function clearSilence() {
  lastEnv = null;
  useAiResults.setState({ silence: null });
}

export function isStillClip(clip: Clip): boolean {
  if (clip.text) return true;
  return useMediaStore.getState().items.find((m) => m.id === clip.mediaId)?.kind === 'image';
}

/** Ripple-removes ranges from the timeline (one undo step). Returns seconds removed. */
export function rippleRemove(ranges: TimeRange[]): number {
  let removed = 0;
  let locked = 0;
  project().commit((d) => {
    const r = removeTimeRanges(d, ranges, isStillClip, () => createId('clp'));
    removed = r.removed;
    locked = r.lockedTracks;
    return r.doc;
  });
  if (locked) notify(`${locked} locked track(s) were not cut and may now be out of sync. Unlock them before removing sections.`, 'warning');
  return removed;
}

export function removeSelectedSilences(): number {
  const cur = useAiResults.getState().silence;
  if (!cur || !isFresh(cur)) {
    notify('The timeline changed since the analysis. Run silence detection again.', 'warning');
    return 0;
  }
  const ranges = cur.ranges.filter((r) => r.selected);
  if (!ranges.length) {
    notify('No pauses are selected.', 'info');
    return 0;
  }
  const removed = rippleRemove(ranges);
  clearSilence();
  notify(`Removed ${ranges.length} pauses (${removed.toFixed(1)} s). Undo with Ctrl+Z.`, 'success');
  track('ai_silence_removed', { pauses: ranges.length, seconds: Math.round(removed) });
  return removed;
}
