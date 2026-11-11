import { create } from 'zustand';
import type { MediaItem } from '../types';

// ---------------------------------------------------------------------------
// Filmstrip frames for timeline video clips. Frames are extracted lazily (only
// for media actually on the timeline), one media at a time, at low resolution,
// and kept in memory only (they are cheap to regenerate after reload).
// ---------------------------------------------------------------------------

export interface Filmstrip {
  /** Seconds between consecutive frames. */
  interval: number;
  frames: string[];
}

interface FilmstripState {
  strips: Record<string, Filmstrip>;
}

export const useFilmstripStore = create<FilmstripState>()(() => ({ strips: {} }));

const FRAME_HEIGHT = 72;
const MAX_FRAMES = 40;
const queue: MediaItem[] = [];
const requested = new Set<string>();
let running = false;

/** Requests a filmstrip for a video media item (no-op if already requested). */
export function requestFilmstrip(media: MediaItem) {
  if (media.kind !== 'video' || media.status !== 'ready' || !media.duration || requested.has(media.id)) return;
  requested.add(media.id);
  queue.push(media);
  void drain();
}

/** Frees frames for media that was removed. */
export function releaseFilmstrip(mediaId: string) {
  requested.delete(mediaId);
  useFilmstripStore.setState((s) => {
    if (!s.strips[mediaId]) return s;
    const { [mediaId]: _removed, ...rest } = s.strips;
    return { strips: rest };
  });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    for (let media = queue.shift(); media; media = queue.shift()) {
      try {
        const strip = await extract(media);
        if (requested.has(media.id)) useFilmstripStore.setState((s) => ({ strips: { ...s.strips, [media!.id]: strip } }));
      } catch {
        /* the clip falls back to the library thumbnail */
      }
    }
  } finally {
    running = false;
  }
}

function extract(media: MediaItem): Promise<Filmstrip> {
  const duration = media.duration ?? 0;
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(duration)));
  const interval = duration / count;
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: string[] = [];
    let i = 0;
    const timeout = window.setTimeout(() => finish(new Error('timeout')), 30000);
    const finish = (err?: Error) => {
      window.clearTimeout(timeout);
      video.onseeked = video.onerror = video.onloadeddata = null;
      video.removeAttribute('src');
      video.load();
      if (err && !frames.length) reject(err);
      else resolve({ interval, frames });
    };
    const seekNext = () => {
      video.currentTime = Math.min(duration - 0.01, (i + 0.5) * interval);
    };
    video.onloadeddata = () => {
      canvas.height = FRAME_HEIGHT;
      canvas.width = Math.max(1, Math.round((video.videoWidth / video.videoHeight) * FRAME_HEIGHT));
      seekNext();
    };
    video.onseeked = () => {
      if (!ctx) return finish(new Error('no 2d context'));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.6));
      i++;
      if (i >= count) finish();
      else seekNext();
    };
    video.onerror = () => finish(new Error('decode error'));
    video.src = media.url;
  });
}
