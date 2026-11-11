import { create } from 'zustand';
import type { ProjectDocument } from '../../types';
import type { TimeRange } from '../../engine/rippleEdit';
import type { WhisperModel } from '../../workers/aiWorker';
import { useProjectStore } from '../../store/projectStore';

// ---------------------------------------------------------------------------
// Results of AI analyses (memory only – never written into the project; the
// edits they lead to are normal undoable timeline edits). Each result keeps
// the document it was computed for: once the timeline changes, timeline-time
// results are shown as stale instead of pointing at the wrong place.
// ---------------------------------------------------------------------------

export interface SilenceRange extends TimeRange {
  selected: boolean;
}

export type SuggestionType = 'silence' | 'duplicate' | 'static' | 'dark' | 'blurry' | 'scene';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  /** Timeline range. 'scene' suggestions are split points (start === end). */
  start: number;
  end: number;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface Highlight {
  id: string;
  /** Timeline range. */
  start: number;
  end: number;
  score: number;
  label: string;
  selected: boolean;
}

export interface SummaryResult {
  summary: string[];
  keywords: string[];
  moments: { time: number; label: string }[];
  highlights: Highlight[];
  basedOn: string[];
}

export interface AiSettings {
  model: WhisperModel;
  language: string;
  /** Where Whisper runs: 'auto' = graphics card when available. */
  device: 'auto' | 'cpu';
}

interface AiResultsState {
  settings: AiSettings;
  silence: { doc: ProjectDocument; ranges: SilenceRange[]; threshold: number; floor: number; speech: number } | null;
  scenes: { doc: ProjectDocument; cuts: number[]; suggestions: Suggestion[]; clipName: string } | null;
  transcript: { doc: ProjectDocument; cues: TranscriptCue[]; language: string } | null;
  summary: { doc: ProjectDocument; result: SummaryResult } | null;
}

const SETTINGS_KEY = 'reelforge.ai.settings';

function loadSettings(): AiSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (s && ['tiny', 'base', 'small'].includes(s.model) && typeof s.language === 'string') return { device: 'cpu', ...s };
  } catch {
    /* private mode / corrupt value */
  }
  return { model: 'base', language: 'auto', device: 'cpu' };
}

export const useAiResults = create<AiResultsState>()(() => ({
  settings: loadSettings(),
  silence: null,
  scenes: null,
  transcript: null,
  summary: null,
}));

export function setAiSettings(patch: Partial<AiSettings>) {
  const settings = { ...useAiResults.getState().settings, ...patch };
  useAiResults.setState({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** True while a result still describes the current timeline. */
export const isFresh = (r: { doc: ProjectDocument } | null) => !!r && r.doc === useProjectStore.getState().document;
export const useIsFresh = (r: { doc: ProjectDocument } | null) => useProjectStore((s) => !!r && r.doc === s.document);

export function clearAiResults() {
  useAiResults.setState({ silence: null, scenes: null, transcript: null, summary: null });
}
