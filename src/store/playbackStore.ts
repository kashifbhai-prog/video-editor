import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Playback store: reactive mirror of the preview engine state. Components read
// from here; they issue commands through `previewEngine` (src/engine).
// ---------------------------------------------------------------------------

interface PlaybackState {
  isPlaying: boolean;
  /** Time in the sequence currently shown (timeline or source preview). */
  currentTime: number;
  duration: number;
  /** Timeline playhead – kept even while the preview shows a library item. */
  timelineTime: number;
  /** True when the loaded sequence supports time-based playback. */
  playable: boolean;
  volume: number;
  muted: boolean;

  _set: (p: Partial<Omit<PlaybackState, '_set'>>) => void;
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  timelineTime: 0,
  playable: false,
  volume: 0.8,
  muted: false,
  _set: (p) => set(p),
}));
