import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { DEFAULT_TEXT_STYLE } from '../../engine/catalog';
import { clipEnd, quantizeToFrame } from '../../engine/timelineModel';
import { levelEnvelope, levelStats, speechWindows, LEVEL_HOP } from '../../engine/ai/audioAnalysis';
import { createId } from '../../utils/id';
import { downloadFile } from '../../utils/storage';
import type { Clip, ProjectDocument, TextStyle, Track } from '../../types';
import { runAiJob, throwIfAborted, type JobControl } from './aiJobs';
import { transcribeAudio, type TranscriptSegment } from './aiWorkerClient';
import { renderTimelineAudio } from './timelineAudio';
import { useAiResults, type TranscriptCue } from './aiStore';

// ---------------------------------------------------------------------------
// AI captions: the timeline audio (same mixdown as the export) → Whisper
// (on-device) → caption cues → ordinary text clips on a "Captions" text
// track. Being normal text clips they are editable, styleable, undoable and
// rendered by the shared compositor, so they appear in the exported video.
// ---------------------------------------------------------------------------

const project = () => useProjectStore.getState();
const notify = (m: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => useUiStore.getState().notify(m, tone);

export const CAPTION_LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu (اردو)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
  { value: 'pa', label: 'Punjabi' },
];

export const CAPTION_MODELS = [
  { value: 'tiny', label: 'Tiny – fastest', size: { cpu: 41, gpu: 120 }, hint: 'Quick drafts; weakest accuracy.' },
  { value: 'base', label: 'Base – balanced', size: { cpu: 77, gpu: 206 }, hint: 'Good English. Urdu is usable but makes mistakes.' },
  { value: 'small', label: 'Small – most accurate', size: { cpu: 249, gpu: 586 }, hint: 'Best for Urdu; slower, needs more memory.' },
] as const;

/** Default look: bold white text with a dark outline and box, near the bottom. */
export const CAPTION_STYLE: TextStyle = {
  ...DEFAULT_TEXT_STYLE,
  fontSize: 54,
  fontWeight: 700,
  color: '#ffffff',
  background: 'rgba(0,0,0,0.55)',
  outlineColor: '#000000',
  outlineWidth: 3,
  lineHeight: 1.25,
};
export const CAPTION_Y = 0.38;

const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const URDU_RE = /[ٹڈڑںھہے]/; // letters specific to Urdu

/** Font for a caption's script (Nastaliq for Urdu, Naskh for Arabic, else the default). */
export function captionFontFor(text: string, base = CAPTION_STYLE.fontFamily): string {
  if (!RTL_RE.test(text)) return base;
  return URDU_RE.test(text) ? 'Noto Nastaliq Urdu' : 'Noto Naskh Arabic';
}

/** Whisper's non-speech annotations ("[Music]", "(applause)", "♪") are not captions. */
const isAnnotation = (t: string) => /^[[(♪*].*[\])♪*]$/.test(t.trim()) || /^[\s.♪-]*$/.test(t);

/** Wraps text into lines of at most `maxChars` characters (word boundaries). */
export function wrapCaption(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Splits text into cues of at most two balanced lines (no lone word left for the next cue). */
export function captionGroups(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  let i = 0;
  while (i < words.length) {
    // As many words as fit on two lines.
    let j = i;
    let len = -1;
    while (j < words.length && len + 1 + words[j].length <= maxChars * 2) len += 1 + words[j++].length;
    if (j === i) j = i + 1; // a single over-long word
    if (j < words.length && words.length - j <= 2 && j - i > 4) j -= 2; // no orphan cue
    const chunk = words.slice(i, j);
    const flat = chunk.join(' ');
    if (flat.length <= maxChars) groups.push(flat);
    else {
      // Break where the two lines are most even.
      let best = 1;
      let bestScore = Infinity;
      for (let k = 1; k < chunk.length; k++) {
        const a = chunk.slice(0, k).join(' ').length;
        const score = Math.max(a, flat.length - a - 1);
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      groups.push(`${chunk.slice(0, best).join(' ')}\n${chunk.slice(best).join(' ')}`);
    }
    i = j;
  }
  return groups;
}

/**
 * Turns recogniser segments into readable cues: at most two lines of
 * `maxChars`, timed proportionally to their characters, never overlapping.
 */
export function segmentsToCues(segments: TranscriptSegment[], maxChars = 42): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text || isAnnotation(text)) continue;
    const groups = captionGroups(text, maxChars);
    const totalChars = groups.reduce((n, g) => n + g.length, 0) || 1;
    let t = s.start;
    for (const g of groups) {
      const d = ((s.end - s.start) * g.length) / totalChars;
      cues.push({ start: t, end: t + d, text: g });
      t += d;
    }
  }
  // No overlaps; minimum readable duration where there is room.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && cues[i].end > next.start) cues[i].end = next.start;
    if (cues[i].end - cues[i].start < 0.7) cues[i].end = Math.min(next ? next.start : Infinity, cues[i].start + 0.7);
  }
  return cues.filter((c) => c.end - c.start > 0.05);
}

/**
 * Groups recognised words into caption cues using the WORD timings, so start /
 * end follow the voice even in fast, continuous speech:
 *  1. strong breaks – sentence punctuation, or a clear pause (≥ 0.3 s between
 *     the words or silent in the audio);
 *  2. phrases still longer than two lines / 6 s are split recursively at the
 *     best weak break (longest pause, comma) that keeps both halves balanced –
 *     no lonely one-word captions.
 * `silenceBetween(a, b)` = longest silence (s) in the audio between two times.
 */
export function wordsToPhrases(words: TranscriptSegment[], maxChars = 42, silenceBetween?: (a: number, b: number) => number): TranscriptSegment[] {
  // Clean word list (punctuation-only "words" merged into the previous word).
  const ws: TranscriptSegment[] = [];
  for (const w of [...words].sort((x, y) => x.start - y.start)) {
    const text = w.text.trim();
    if (!text) continue;
    const last = ws[ws.length - 1];
    if (last && /^[.,!?;:،۔؟]+$/.test(text)) ws[ws.length - 1] = { ...last, text: last.text + text, end: Math.max(last.end, w.end) };
    else ws.push({ start: w.start, end: w.end, text });
  }
  const pause = (i: number) => Math.max(ws[i].start - ws[i - 1].end, silenceBetween ? silenceBetween(ws[i - 1].start + 0.08, ws[i].end - 0.04) : 0);
  const textOf = (g: TranscriptSegment[]) => g.map((w) => w.text).join(' ');
  const phrase = (g: TranscriptSegment[]): TranscriptSegment => ({ start: g[0].start, end: g[g.length - 1].end, text: textOf(g) });

  // 1. Strong breaks.
  const groups: TranscriptSegment[][] = [];
  let cur: TranscriptSegment[] = [];
  ws.forEach((w, i) => {
    if (cur.length && (/[.!?۔؟]["')]]?$/.test(ws[i - 1].text) || pause(i) >= 0.3)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  });
  if (cur.length) groups.push(cur);

  // 2. Long phrases: recursive balanced split at weak breaks.
  const fits = (g: TranscriptSegment[]) => textOf(g).length <= maxChars * 2 && g[g.length - 1].end - g[0].start <= 6;
  const split = (g: TranscriptSegment[], offset: number): TranscriptSegment[][] => {
    if (g.length < 2 || fits(g)) return [g];
    const total = textOf(g).length;
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 1; k < g.length; k++) {
      const left = textOf(g.slice(0, k)).length;
      const balance = Math.abs(left - (total - left - 1)) / total; // 0 = even
      const comma = /[,;:،]$/.test(g[k - 1].text) ? 0.15 : 0;
      const tiny = k < 2 || g.length - k < 2 ? 0.5 : 0; // avoid one-word halves
      const score = Math.min(0.5, pause(offset + k)) + comma - balance * 0.6 - tiny;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return [...split(g.slice(0, best), offset), ...split(g.slice(best), offset + best)];
  };
  const out: TranscriptSegment[] = [];
  let offset = 0;
  for (const g of groups) {
    split(g, offset).forEach((x) => out.push(phrase(x)));
    offset += g.length;
  }
  return out;
}

/**
 * Whisper's segment timestamps are coarse (they often start at the beginning
 * of the audio window). Each segment edge is snapped to where speech actually
 * starts / stops in the level envelope, so captions appear with the voice.
 */
export function snapToSpeech(s: TranscriptSegment, env: Float32Array, threshold: number, reach = 0.8): TranscriptSegment {
  const at = (t: number) => Math.max(0, Math.min(env.length - 1, Math.round(t / LEVEL_HOP)));
  let start = s.start;
  for (let k = at(s.start - 0.15); k <= at(s.start + reach); k++) {
    if (env[k] >= threshold) {
      start = Math.max(0, k * LEVEL_HOP - 0.05);
      break;
    }
  }
  let end = s.end;
  for (let k = at(s.end + Math.min(0.3, reach / 4)); k >= at(s.end - reach); k--) {
    if (env[k] >= threshold) {
      end = k * LEVEL_HOP + 0.15;
      break;
    }
  }
  return end - start > 0.3 ? { ...s, start, end } : s;
}

// ---- Timeline -----------------------------------------------------------------------------

export const captionTracks = (doc: ProjectDocument) => doc.tracks.filter((t) => t.type === 'text' && t.captions);

export function captionClips(doc: ProjectDocument): Clip[] {
  const ids = new Set(captionTracks(doc).map((t) => t.id));
  return Object.values(doc.clips)
    .filter((c) => ids.has(c.trackId) && c.text)
    .sort((a, b) => a.start - b.start);
}

/**
 * Writes cues as text clips on the captions track (created when missing), in
 * ONE undo step. `replace`: existing captions are removed first.
 */
export function placeCaptions(cues: TranscriptCue[], replace: boolean, style: Partial<TextStyle> = {}): number {
  const fps = project().document.canvas.frameRate;
  let placed = 0;
  project().transaction(() => {
    let track: Track | undefined = captionTracks(project().document).find((t) => !t.locked);
    if (!track) {
      const id = project().addTrack('text');
      project().commit((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, name: 'Captions', captions: true } : t)) }));
      track = project().document.tracks.find((t) => t.id === id)!;
    }
    const trackId = track.id;
    // Keep the look of existing captions (the user may have restyled them).
    const existing = captionClips(project().document).find((c) => c.trackId === trackId);
    const baseStyle = { ...CAPTION_STYLE, ...existing?.text?.style, ...style };
    const y = existing?.transform.y ?? CAPTION_Y;
    project().commit((d) => {
      const clips = { ...d.clips };
      if (replace) for (const c of Object.values(clips)) if (c.trackId === trackId) delete clips[c.id];
      const occupied = Object.values(clips).filter((c) => c.trackId === trackId);
      for (const cue of cues) {
        const start = quantizeToFrame(cue.start, fps);
        const end = Math.max(start + 1 / fps, quantizeToFrame(cue.end, fps));
        if (occupied.some((o) => o.start < end - 1e-6 && clipEnd(o) > start + 1e-6)) continue;
        const clip: Clip = {
          id: createId('clp'),
          mediaId: '',
          trackId,
          name: cue.text.split('\n')[0].slice(0, 40),
          start,
          sourceIn: 0,
          sourceOut: end - start,
          speed: 1,
          volume: 1,
          opacity: 1,
          transform: { x: 0, y, scale: 1 },
          text: { content: cue.text, style: { ...baseStyle, fontFamily: captionFontFor(cue.text, baseStyle.fontFamily) } },
        };
        clips[clip.id] = clip;
        occupied.push(clip);
        placed++;
      }
      return { ...d, clips };
    });
  });
  return placed;
}

// ---- Generation ---------------------------------------------------------------------------

export interface CaptionOptions {
  /** Only these clips' audio (e.g. the selected clip); default: the whole timeline mix. */
  clipIds?: string[];
  replace: boolean;
  maxChars?: number;
}

/**
 * Speech → text for the timeline mix (or some clips), in timeline time:
 * Whisper on the voiced windows only, hallucinations in silence dropped,
 * segment edges snapped to where the voice starts / stops.
 */
export async function transcribeTimeline(clipIds: string[] | undefined, ctl: JobControl, range: [number, number]): Promise<{ segments: TranscriptSegment[]; device: string }> {
  const { model, language, device: devicePref } = useAiResults.getState().settings;
  const [lo, hi] = range;
  const audio = await renderTimelineAudio({ clipIds, sampleRate: 16000 }, ctl, [lo, lo + (hi - lo) * 0.08]);
  if (!audio) throw new Error('There is no audible audio on the timeline (check muted tracks).');
  throwIfAborted(ctl.signal);
  const env = levelEnvelope(audio.mono, audio.sampleRate);
  const stats = levelStats(env);
  const windows = speechWindows(env, stats.threshold, audio.duration);
  if (!windows.length) throw new Error('No speech was found in the audio.');
  const { segments, device } = await transcribeAudio(audio.mono, windows, model, language, devicePref, ctl, [lo + (hi - lo) * 0.08, hi]);
  throwIfAborted(ctl.signal);
  /** Longest silent run (s) in [a, b] of the level envelope. */
  const silenceBetween = (a: number, b: number) => {
    let best = 0;
    let run = 0;
    for (let k = Math.max(0, Math.floor(a / LEVEL_HOP)); k <= Math.min(env.length - 1, Math.ceil(b / LEVEL_HOP)); k++) {
      run = env[k] < stats.threshold ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best * LEVEL_HOP;
  };
  const phrases = wordsToPhrases(segments, 42, silenceBetween);
  const voiced = phrases.filter((seg) => {
    const a = Math.floor(seg.start / LEVEL_HOP);
    const b = Math.max(a + 1, Math.ceil(seg.end / LEVEL_HOP));
    let loud = 0;
    for (let k = a; k < b && k < env.length; k++) if (env[k] >= stats.threshold) loud++;
    return loud / (b - a) > 0.1;
  });
  // Word timings are already close: only fine-snap the phrase edges to the voice.
  return { segments: voiced.map((seg) => snapToSpeech(seg, env, stats.threshold, 0.35)), device };
}

export async function generateCaptions(opts: CaptionOptions): Promise<number | null> {
  const { model, language } = useAiResults.getState().settings;
  const doc = project().document;
  return runAiJob('captions', 'Auto captions', async (ctl) => {
    const { segments, device } = await transcribeTimeline(opts.clipIds, ctl, [0, 0.98]);
    const cues = segmentsToCues(segments, opts.maxChars ?? 42);
    if (!cues.length) throw new Error('No speech could be recognised.');
    if (project().document !== doc) {
      // The user edited the timeline meanwhile: the timings would no longer match.
      throw new Error('The timeline changed while captions were being generated. Please run it again.');
    }
    const placed = placeCaptions(cues, opts.replace);
    useAiResults.setState({ transcript: { doc: project().document, cues: segments, language } });
    notify(`${placed} captions added (${model} model on the ${device === 'webgpu' ? 'GPU' : 'CPU'}). Edit them in the Captions panel.`, 'success');
    return placed;
  });
}

// ---- Editing ------------------------------------------------------------------------------

/** Applies a style / position change to every caption (one undo step). */
export function styleAllCaptions(style: Partial<TextStyle>, y?: number, coalesceKey?: string) {
  const ids = captionClips(project().document).map((c) => c.id);
  project().updateClips(
    ids,
    (c) => ({
      text: { ...c.text!, style: { ...c.text!.style, ...style } },
      ...(y !== undefined ? { transform: { ...c.transform, y } } : {}),
    }),
    coalesceKey,
  );
}

export function setCaptionTiming(clipId: string, start: number, end: number) {
  const fps = project().document.canvas.frameRate;
  const s = quantizeToFrame(Math.max(0, start), fps);
  const e = Math.max(s + 1 / fps, quantizeToFrame(end, fps));
  const clip = project().document.clips[clipId];
  if (!clip) return;
  // Refuse overlaps with neighbouring captions.
  const clash = Object.values(project().document.clips).some((o) => o.id !== clipId && o.trackId === clip.trackId && o.start < e - 1e-6 && clipEnd(o) > s + 1e-6);
  if (clash) {
    notify('Captions on the same track cannot overlap.', 'warning');
    return;
  }
  project().setClipTiming(clipId, { start: s, sourceIn: 0, sourceOut: e - s });
}

/** Shifts all captions by `delta` seconds (sync correction). */
export function shiftAllCaptions(delta: number) {
  const doc = project().document;
  const clips = captionClips(doc);
  if (!clips.length) return;
  if (clips[0].start + delta < 0) delta = -clips[0].start;
  const fps = doc.canvas.frameRate;
  project().commit((d) => {
    const next = { ...d.clips };
    for (const c of clips) next[c.id] = { ...c, start: quantizeToFrame(c.start + delta, fps) };
    return { ...d, clips: next };
  });
}

// ---- SRT ----------------------------------------------------------------------------------

const srtTime = (t: number) => {
  const ms = Math.round(Math.max(0, t) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export function captionsToSrt(doc: ProjectDocument): string {
  return captionClips(doc)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(clipEnd(c))}\n${c.text!.content}\n`)
    .join('\n');
}

export function exportSrt() {
  const doc = project().document;
  if (!captionClips(doc).length) return notify('There are no captions to export.', 'warning');
  downloadFile(`${doc.name || 'captions'}.srt`, captionsToSrt(doc), 'application/x-subrip');
}

export function parseSrt(src: string): TranscriptCue[] {
  const toSec = (s: string) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000 : NaN;
  };
  const cues: TranscriptCue[] = [];
  for (const block of src.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = toSec(a);
    const end = toSec(b);
    const text = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  return cues;
}

export async function importSrt(file: File) {
  const cues = parseSrt(await file.text());
  if (!cues.length) return notify('No subtitles were found in this file.', 'warning');
  const n = placeCaptions(cues, false);
  notify(`${n} subtitles imported.`, 'success');
}
