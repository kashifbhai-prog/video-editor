import { Film, Layers, Music, Type, type LucideIcon } from 'lucide-react';
import type { TrackType } from '../../types';

export const HEADER_WIDTH = 188;
export const RULER_HEIGHT = 28;
/** Minimum visible timeline length in seconds. */
export const MIN_TIMELINE_SECONDS = 60;
export const TIMELINE_TAIL_SECONDS = 15;

export const TRACK_HEIGHT: Record<TrackType, number> = {
  video: 64,
  overlay: 44,
  text: 36,
  audio: 48,
};

export const TRACK_ICON: Record<TrackType, LucideIcon> = {
  video: Film,
  overlay: Layers,
  text: Type,
  audio: Music,
};

export const TRACK_COLOR_VAR: Record<TrackType, string> = {
  video: 'var(--color-track-video)',
  overlay: 'var(--color-track-overlay)',
  text: 'var(--color-track-text)',
  audio: 'var(--color-track-audio)',
};

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Picks ruler tick spacing so that labelled ticks are at least `minPx` apart. */
export function getTickSpacing(pxPerSecond: number, minPx = 84) {
  const major = TICK_STEPS.find((s) => s * pxPerSecond >= minPx) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const subdivisions = major >= 60 ? 6 : major === 15 ? 3 : major === 2 || major === 0.2 ? 4 : 5;
  return { major, minor: major / subdivisions };
}
