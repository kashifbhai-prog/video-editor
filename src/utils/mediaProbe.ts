import type { MediaKind } from '../types';

export interface ProbeResult {
  /** Set when the detected kind differs from the MIME guess (e.g. audio-only .webm). */
  kind?: MediaKind;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  waveform?: number[];
}

const THUMB_WIDTH = 320;
const PROBE_TIMEOUT_MS = 20000;
const WAVEFORM_BARS = 400;
/** Skip full audio decoding for very large files to keep imports responsive. */
const WAVEFORM_MAX_BYTES = 60 * 1024 * 1024;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function drawThumbnail(source: CanvasImageSource, srcW: number, srcH: number): string | undefined {
  if (!srcW || !srcH) return undefined;
  const scale = Math.min(1, THUMB_WIDTH / srcW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return undefined;
  }
}

/**
 * Some files (notably WebM recorded by MediaRecorder) report an infinite
 * duration until the whole file is scanned. Seeking far past the end forces
 * the browser to compute the real duration.
 */
function resolveDuration(el: HTMLMediaElement): Promise<number | undefined> {
  if (Number.isFinite(el.duration)) return Promise.resolve(el.duration);
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('seeked', done);
      el.removeEventListener('durationchange', onChange);
      resolve(Number.isFinite(el.duration) ? el.duration : undefined);
    };
    const onChange = () => Number.isFinite(el.duration) && done();
    el.addEventListener('seeked', done);
    el.addEventListener('durationchange', onChange);
    el.currentTime = 1e101;
  });
}

function probeVideo(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let duration: number | undefined;

    const cleanup = () => {
      video.onseeked = null;
      video.removeAttribute('src');
      video.load();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('This video format or codec cannot be decoded by your browser.'));
    };

    video.onloadedmetadata = async () => {
      video.onloadedmetadata = null;
      if (!video.videoWidth || !video.videoHeight) {
        cleanup();
        reject(new NoVideoStreamError());
        return;
      }
      duration = await resolveDuration(video);
      video.onseeked = () => {
        const result: ProbeResult = {
          duration,
          width: video.videoWidth,
          height: video.videoHeight,
          thumbnail: drawThumbnail(video, video.videoWidth, video.videoHeight),
        };
        cleanup();
        resolve(result);
      };
      // Seek a little into the clip so the thumbnail is not a black first frame.
      video.currentTime = Math.min(1, (duration ?? 0) * 0.1);
    };

    video.src = url;
  });
}

function probeImage(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 1920;
      const height = img.naturalHeight || 1080;
      resolve({ width, height, thumbnail: drawThumbnail(img, width, height) });
    };
    img.onerror = () => reject(new Error('This image could not be decoded.'));
    img.src = url;
  });
}

function probeAudioDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = async () => {
      audio.onloadedmetadata = null;
      resolve(await resolveDuration(audio));
      audio.removeAttribute('src');
    };
    audio.onerror = () => reject(new Error('This audio format cannot be decoded by your browser.'));
    audio.src = url;
  });
}

async function computeWaveform(file: Blob): Promise<number[] | undefined> {
  if (file.size > WAVEFORM_MAX_BYTES) return undefined;
  const Ctx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctx) return undefined;
  try {
    const ctx = new Ctx(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / WAVEFORM_BARS));
    const peaks: number[] = [];
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      let max = 0;
      const start = i * block;
      // Sample with a stride for speed on long files.
      const stride = Math.max(1, Math.floor(block / 2000));
      for (let j = 0; j < block; j += stride) {
        const v = Math.abs(data[start + j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.0001);
    return peaks.map((p) => Math.round((p / top) * 1000) / 1000);
  } catch {
    return undefined;
  }
}

/** Reads duration, dimensions, thumbnail and waveform for an imported file. */
export async function probeMedia(kind: MediaKind, file: Blob, url: string): Promise<ProbeResult> {
  switch (kind) {
    case 'video':
      try {
        return await withTimeout(probeVideo(url), PROBE_TIMEOUT_MS, 'Timed out while reading the video.');
      } catch (err) {
        // Containers like .webm / .mp4 are reported as video/* even when they
        // only hold audio (voice memos, screen-recorder audio). Treat as audio.
        if (err instanceof NoVideoStreamError) {
          return { ...(await probeAudio(file, url)), kind: 'audio' };
        }
        throw err;
      }
    case 'image':
      return withTimeout(probeImage(url), PROBE_TIMEOUT_MS, 'Timed out while reading the image.');
    case 'audio':
      return probeAudio(file, url);
  }
}

async function probeAudio(file: Blob, url: string): Promise<ProbeResult> {
  const duration = await withTimeout(probeAudioDuration(url), PROBE_TIMEOUT_MS, 'Timed out while reading the audio file.');
  const waveform = await computeWaveform(file);
  return { duration, waveform };
}

class NoVideoStreamError extends Error {
  constructor() {
    super('The file contains no decodable video or audio stream.');
  }
}
