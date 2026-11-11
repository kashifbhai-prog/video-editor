import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { candidateCuts, runsWhere, sampleFeatures, sceneSimilarity, scenesFrom, type FrameFeature, type Scene } from '../../engine/ai/videoAnalysis';
import { detectSilences, levelEnvelope, levelStats, toMono, LEVEL_HOP } from '../../engine/ai/audioAnalysis';
import { clipEnd, quantizeToFrame } from '../../engine/timelineModel';
import { decodeMediaAudio } from '../audioDsp';
import { createId } from '../../utils/id';
import type { Clip } from '../../types';
import { runAiJob, throwIfAborted } from './aiJobs';
import { isFresh, useAiResults, type Suggestion } from './aiStore';
import { isStillClip, rippleRemove } from './silence';

// ---------------------------------------------------------------------------
// Smart editing for one video clip: scene changes (frame-exact), repeated
// takes, frozen + silent footage, dark and blurry stretches, long pauses.
// Each finding is a suggestion the user accepts (→ a real timeline split or
// ripple cut, undoable) or rejects.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

const SAMPLE_FPS = 5;

/** Per-scene analysis kept for summaries / highlights (source → timeline mapped). */
export interface SceneInfo {
  start: number;
  end: number;
  motion: number;
  speech: number;
  luma: number;
}
let lastScenes: { clipId: string; scenes: SceneInfo[] } | null = null;
export const getLastScenes = () => lastScenes;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function analyzeClip(clipId: string): Promise<Suggestion[] | null> {
  const clip = project().document.clips[clipId];
  const media = clip && useMediaStore.getState().items.find((m) => m.id === clip.mediaId);
  if (!clip || !media || media.kind !== 'video') {
    notify('Select a video clip on the timeline to analyse.', 'warning');
    return null;
  }
  if (clip.reversed) {
    notify('Smart editing does not analyse reversed clips. Turn off Reverse first.', 'warning');
    return null;
  }
  const doc = project().document;
  const fps = doc.canvas.frameRate;
  const toTimeline = (src: number) => clip.start + (src - clip.sourceIn) / clip.speed;

  return runAiJob('scenes', 'Scene analysis', async (ctl) => {
    ctl.progress('Reading frames', 0);
    const from = clip.sourceIn;
    const to = clip.sourceOut;
    const { features, refine } = await sampleFeatures({ url: media.url, from, to, fps: SAMPLE_FPS, signal: ctl.signal, onProgress: (f) => ctl.progress('Reading frames', f * 0.7) });
    throwIfAborted(ctl.signal);
    if (features.length < 3) throw new Error('The clip is too short to analyse.');

    // 1. Scene cuts, refined to the exact frame.
    ctl.progress('Finding scene changes', 0.72);
    const idx = candidateCuts(features);
    const cuts: number[] = [];
    for (const i of idx) {
      throwIfAborted(ctl.signal);
      cuts.push(await refine(features[i - 1].t, features[i].t, 30));
    }
    const scenes = scenesFrom(features, cuts, from, to);

    // 2. Audio of the clip (pauses + speech activity per scene).
    ctl.progress('Listening', 0.85);
    const buf = await decodeMediaAudio(media.url);
    let env: Float32Array | null = null;
    let thr = -60;
    if (buf) {
      const mono = toMono(buf).subarray(Math.floor(from * buf.sampleRate), Math.ceil(to * buf.sampleRate));
      env = levelEnvelope(mono, buf.sampleRate);
      thr = levelStats(env).threshold;
    }
    const speechIn = (s: number, e: number) => {
      if (!env) return 0;
      const a = Math.floor((s - from) / LEVEL_HOP);
      const b = Math.ceil((e - from) / LEVEL_HOP);
      let n = 0;
      for (let k = Math.max(0, a); k < Math.min(env.length, b); k++) if (env[k] >= thr) n++;
      return n / Math.max(1, b - a);
    };

    const sug: Suggestion[] = [];
    const add = (type: Suggestion['type'], s: number, e: number, reason: string) => {
      const start = quantizeToFrame(Math.max(clip.start, toTimeline(s)), fps);
      const end = quantizeToFrame(Math.min(clipEnd(clip), toTimeline(e)), fps);
      if (type !== 'scene' && end - start < 0.3) return;
      sug.push({ id: createId('sug'), type, start, end, reason, status: 'pending' });
    };

    for (const c of cuts) add('scene', c, c, 'Scene change – split here to edit the scenes separately.');

    // 3. Repeated takes: a later scene that looks like an earlier one → suggest dropping the earlier.
    const used = new Set<number>();
    for (let i = 0; i < scenes.length; i++) {
      for (let j = i + 1; j < scenes.length; j++) {
        if (used.has(i)) break;
        const a = scenes[i];
        const b = scenes[j];
        const la = a.end - a.start;
        const lb = b.end - b.start;
        if (Math.min(la, lb) < 1 || Math.min(la, lb) / Math.max(la, lb) < 0.6) continue;
        if (sceneSimilarity(a, b) < 0.12) {
          used.add(i);
          add('duplicate', a.start, a.end, `Repeats the scene at ${toTimeline(b.start).toFixed(1)} s – remove this earlier take?`);
        }
      }
    }

    // 4. Unwanted footage.
    const step = 1 / SAMPLE_FPS;
    for (const r of runsWhere(features, step, (f) => f.luma < 0.06, 1)) add('dark', r.start, r.end, 'Black / very dark footage.');
    // Blur = focus clearly lost compared with the rest of the SAME scene (plain
    // graphics are smooth by nature and must not count as blurry).
    for (const sc of scenes) {
      const sharp = sc.features.map((f) => f.sharp).sort((a, b) => a - b);
      if (sharp.length < 8) continue;
      const ref = sharp[Math.floor(sharp.length * 0.8)];
      for (const r of runsWhere(sc.features, step, (f) => f.luma >= 0.06 && f.sharp < ref * 0.3, 1.5)) add('blurry', r.start, r.end, 'Out-of-focus / blurry footage.');
    }
    for (const r of runsWhere(features, step, (f) => f.motion < 0.002 && f.luma >= 0.06, 3)) {
      if (speechIn(r.start, r.end) < 0.05) add('static', r.start, r.end, 'Nothing moves and nobody speaks.');
    }
    if (env) {
      for (const r of detectSilences(env, { threshold: thr, minDuration: 1.2, padding: 0.15 })) add('silence', from + r.start, from + r.end, 'Long pause.');
    }
    // Overlapping removals: the earlier-listed (more specific) one wins; later
    // ones keep only their non-overlapping parts.
    const priority: Suggestion['type'][] = ['duplicate', 'dark', 'blurry', 'static', 'silence'];
    const removals = sug.filter((s) => s.type !== 'scene').sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type) || a.start - b.start);
    const kept: Suggestion[] = [];
    for (const s of removals) {
      let parts = [{ start: s.start, end: s.end }];
      for (const k of kept) {
        parts = parts.flatMap((p) => (p.end <= k.start || p.start >= k.end ? [p] : [{ start: p.start, end: k.start }, { start: k.end, end: p.end }]).filter((q) => q.end - q.start >= 0.3));
      }
      parts.forEach((p, i) => kept.push({ ...s, id: i ? createId('sug') : s.id, start: p.start, end: p.end }));
    }
    const final = [...sug.filter((s) => s.type === 'scene'), ...kept].sort((a, b) => a.start - b.start);

    lastScenes = {
      clipId,
      scenes: scenes.map((s: Scene) => ({
        start: toTimeline(s.start),
        end: toTimeline(s.end),
        motion: mean(s.features.map((f: FrameFeature) => f.motion)),
        speech: speechIn(s.start, s.end),
        luma: mean(s.features.map((f) => f.luma)),
      })),
    };
    useAiResults.setState({ scenes: { doc: project().document, cuts: cuts.map((c) => quantizeToFrame(toTimeline(c), fps)), suggestions: final, clipName: clip.name } });
    if (project().document !== doc) throw new Error('The timeline changed during the analysis. Please run it again.');
    notify(`${cuts.length} scene change${cuts.length === 1 ? '' : 's'} and ${kept.length} suggested cut${kept.length === 1 ? '' : 's'} found.`, 'success');
    return final;
  });
}

// ---- Accept / reject --------------------------------------------------------------------

function setSuggestions(map: (s: Suggestion) => Suggestion) {
  const cur = useAiResults.getState().scenes;
  if (!cur) return;
  useAiResults.setState({ scenes: { ...cur, doc: project().document, suggestions: cur.suggestions.map(map) } });
}

function splitAt(t: number) {
  const doc = project().document;
  // Split every unlocked clip under the cut that sits on the analysed clip's tracks (picture + its own audio).
  const ids = Object.values(doc.clips)
    .filter((c: Clip) => !c.text && c.start < t - 1e-6 && clipEnd(c) > t + 1e-6 && !doc.tracks.find((tr) => tr.id === c.trackId)?.locked)
    .map((c) => c.id);
  project().splitClips(ids, t, (mediaId) => useMediaStore.getState().items.find((m) => m.id === mediaId)?.kind === 'image');
}

function ensureFresh(): boolean {
  const cur = useAiResults.getState().scenes;
  if (!cur || !isFresh(cur)) {
    notify('The timeline changed since the analysis. Analyse the clip again.', 'warning');
    return false;
  }
  return true;
}

export function acceptSuggestion(id: string) {
  if (!ensureFresh()) return;
  const s = useAiResults.getState().scenes!.suggestions.find((x) => x.id === id);
  if (!s || s.status !== 'pending') return;
  if (s.type === 'scene') {
    splitAt(s.start);
    setSuggestions((x) => (x.id === id ? { ...x, status: 'accepted' } : x));
    return;
  }
  const len = s.end - s.start;
  rippleRemove([{ start: s.start, end: s.end }]);
  // Later suggestions move left with the timeline.
  setSuggestions((x) => {
    if (x.id === id) return { ...x, status: 'accepted' };
    if (x.start >= s.end - 1e-6) return { ...x, start: x.start - len, end: x.end - len };
    if (x.type === 'scene' && x.start > s.start) return { ...x, status: 'rejected' }; // inside the removed range
    return x;
  });
}

export function rejectSuggestion(id: string) {
  setSuggestions((x) => (x.id === id ? { ...x, status: 'rejected' } : x));
}

/** Accepts every pending suggestion of the given kinds in ONE undo step. */
export function acceptAllSuggestions(kinds: 'cuts' | 'splits' | 'all' = 'all') {
  if (!ensureFresh()) return;
  const pending = useAiResults.getState().scenes!.suggestions.filter((s) => s.status === 'pending');
  const splits = kinds === 'cuts' ? [] : pending.filter((s) => s.type === 'scene');
  const cuts = kinds === 'splits' ? [] : pending.filter((s) => s.type !== 'scene');
  if (!splits.length && !cuts.length) return;
  project().transaction(() => {
    for (const s of splits) if (!cuts.some((c) => s.start > c.start && s.start < c.end)) splitAt(s.start);
    if (cuts.length) rippleRemove(cuts.map((c) => ({ start: c.start, end: c.end })));
  });
  const done = new Set([...splits, ...cuts].map((s) => s.id));
  // Remaining suggestions move left by the time removed before them; those inside a cut are gone.
  const shiftOf = (t: number) => cuts.filter((c) => c.end <= t + 1e-6).reduce((n, c) => n + c.end - c.start, 0);
  const inside = (x: Suggestion) => cuts.some((c) => x.start >= c.start - 1e-6 && x.end <= c.end + 1e-6);
  setSuggestions((x) => {
    if (done.has(x.id)) return { ...x, status: 'accepted' };
    if (x.status !== 'pending') return x;
    if (inside(x)) return { ...x, status: 'rejected' };
    const d = shiftOf(x.start);
    return d ? { ...x, start: x.start - d, end: x.end - d } : x;
  });
  notify(`Applied ${splits.length} split${splits.length === 1 ? '' : 's'} and ${cuts.length} cut${cuts.length === 1 ? '' : 's'}. Undo with Ctrl+Z.`, 'success');
}

export { isStillClip };
