import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { keywords, pickHighlights, rankSentences, toSentences, type HighlightCandidate, type TimedText } from '../../engine/ai/summarize';
import { copyRangesToEnd } from '../../engine/rippleEdit';
import { clipEnd, sequenceDuration } from '../../engine/timelineModel';
import { previewEngine } from '../../engine/previewEngine';
import { createId } from '../../utils/id';
import { formatTimecode } from '../../utils/format';
import { runAiJob } from './aiJobs';
import { isFresh, useAiResults, type Highlight, type SummaryResult } from './aiStore';
import { captionClips, transcribeTimeline } from './captions';
import { getLastScenes } from './smartEdit';
import { isStillClip } from './silence';
import { track } from '../analytics';
import { selectClips } from '../editingService';

// ---------------------------------------------------------------------------
// Video summary & highlights, fully on-device: the transcript (existing
// captions, the last transcription, or a fresh Whisper run) is summarised
// extractively; important moments carry timestamps; highlight ranges are
// inserted as normal, editable clips (a highlight reel after the edit).
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

const short = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export async function summarizeTimeline(targetSeconds = 30): Promise<SummaryResult | null> {
  const doc = project().document;
  if (!Object.keys(doc.clips).length) {
    notify('The timeline is empty.', 'info');
    return null;
  }
  return runAiJob('summary', 'Video summary', async (ctl) => {
    const basedOn: string[] = [];
    // 1. Words: the captions on the timeline (they may have been corrected by
    //    the user), else the last transcript, else transcribe now.
    let lines: TimedText[] = captionClips(doc).map((c) => ({ start: c.start, end: clipEnd(c), text: c.text!.content }));
    if (lines.length) basedOn.push(`${lines.length} captions`);
    else {
      const t = useAiResults.getState().transcript;
      if (t && isFresh(t)) lines = t.cues;
      else {
        try {
          lines = (await transcribeTimeline(undefined, ctl, [0, 0.9])).segments;
        } catch (e) {
          // No speech is fine: the summary then relies on the pictures.
          if (!/No speech|no audible/i.test(e instanceof Error ? e.message : '')) throw e;
          lines = [];
        }
      }
      if (lines.length) basedOn.push('speech transcript');
    }
    ctl.progress('Summarising', 0.92);
    const sentences = toSentences(lines);
    const ranked = rankSentences(sentences);
    const k = Math.max(1, Math.min(5, Math.round(ranked.length / 3)));
    const top = [...ranked].sort((a, b) => b.score - a.score).slice(0, k).sort((a, b) => a.start - b.start);

    // 2. Pictures: the last scene analysis, when it is for this timeline.
    const scenes = getLastScenes();
    const sceneInfo = scenes && doc.clips[scenes.clipId] ? scenes.scenes : [];
    if (sceneInfo.length) basedOn.push(`${sceneInfo.length} scenes`);

    const moments = [...ranked]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => ({ time: s.start, label: short(s.text) }));
    if (!moments.length) {
      const maxMotion = Math.max(1e-6, ...sceneInfo.map((s) => s.motion));
      sceneInfo
        .map((s) => ({ s, score: s.motion / maxMotion + s.speech }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .forEach(({ s }) => moments.push({ time: s.start, label: `Scene at ${formatTimecode(s.start)} (${(s.end - s.start).toFixed(1)} s)` }));
    }
    moments.sort((a, b) => a.time - b.time);

    // 3. Highlights: the best sentences; without speech, the liveliest scenes.
    let cands: HighlightCandidate[] = ranked.map((s) => ({ start: s.start, end: s.end, score: s.score, label: short(s.text, 60) }));
    if (!cands.length) {
      const maxMotion = Math.max(1e-6, ...sceneInfo.map((s) => s.motion));
      cands = sceneInfo.map((s) => {
        const mid = (s.start + s.end) / 2;
        const half = Math.min(2.5, (s.end - s.start) / 2);
        return { start: mid - half, end: mid + half, score: s.motion / maxMotion, label: `Scene at ${formatTimecode(s.start)}` };
      });
    }
    const duration = sequenceDuration(doc);
    const highlights: Highlight[] = pickHighlights(cands, targetSeconds, duration).map((h) => ({ id: createId('hl'), start: h.start, end: h.end, score: h.score, label: h.label, selected: true }));

    if (!top.length && !moments.length) throw new Error('Nothing to summarise: no speech was found. Run Scene analysis on a video clip first to summarise by pictures.');
    const result: SummaryResult = {
      summary: top.map((s) => s.text),
      keywords: keywords(sentences),
      moments,
      highlights,
      basedOn,
    };
    useAiResults.setState({ summary: { doc, result } });
    return result;
  });
}

export function toggleHighlight(id: string) {
  const cur = useAiResults.getState().summary;
  if (!cur) return;
  useAiResults.setState({ summary: { ...cur, result: { ...cur.result, highlights: cur.result.highlights.map((h) => (h.id === id ? { ...h, selected: !h.selected } : h)) } } });
}

/** Inserts the selected highlights after the edit as editable clips (all tracks in sync). One undo step. */
export function insertHighlights(): string[] {
  const cur = useAiResults.getState().summary;
  if (!cur || !isFresh(cur)) {
    notify('The timeline changed since the summary. Generate it again.', 'warning');
    return [];
  }
  const ranges = cur.result.highlights.filter((h) => h.selected);
  if (!ranges.length) {
    notify('Select at least one highlight.', 'info');
    return [];
  }
  let at = 0;
  let ids: string[] = [];
  project().commit((d) => {
    const r = copyRangesToEnd(d, ranges, isStillClip, () => createId('clp'));
    at = r.at;
    ids = r.ids;
    return r.doc;
  });
  // The summary still describes the original part, which did not move.
  useAiResults.setState({ summary: { ...cur, doc: project().document } });
  if (ids.length) {
    previewEngine.seek(at);
    selectClips(ids);
    const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
    notify(`Highlight reel (${ranges.length} clips, ${total.toFixed(1)} s) added at ${formatTimecode(at)}. Undo with Ctrl+Z.`, 'success');
    track('ai_highlights', { highlights: ranges.length, seconds: Math.round(total) });
  }
  return ids;
}
