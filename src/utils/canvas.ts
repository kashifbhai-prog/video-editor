import type { AspectRatio, ResolutionPreset } from '../types';

export const ASPECT_RATIOS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '16:9', label: '16:9', hint: 'Landscape · YouTube' },
  { value: '9:16', label: '9:16', hint: 'Portrait · Shorts, Reels' },
  { value: '1:1', label: '1:1', hint: 'Square · Feed post' },
  { value: '4:5', label: '4:5', hint: 'Vertical · Feed post' },
];

export const RESOLUTIONS: { value: ResolutionPreset; label: string; shortSide: number }[] = [
  { value: '720p', label: '720p HD', shortSide: 720 },
  { value: '1080p', label: '1080p Full HD', shortSide: 1080 },
  { value: '1440p', label: '1440p 2K', shortSide: 1440 },
  { value: '2160p', label: '2160p 4K', shortSide: 2160 },
];

export const FRAME_RATES = [24, 25, 30, 50, 60] as const;

export function aspectToNumber(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** Canvas pixel dimensions for an aspect ratio + resolution preset (short side = preset). */
export function getCanvasSize(aspect: AspectRatio, resolution: ResolutionPreset) {
  const shortSide = RESOLUTIONS.find((r) => r.value === resolution)?.shortSide ?? 1080;
  const ratio = aspectToNumber(aspect);
  const even = (n: number) => Math.round(n / 2) * 2;
  if (ratio >= 1) return { width: even(shortSide * ratio), height: shortSide };
  return { width: shortSide, height: even(shortSide / ratio) };
}

/** Largest box with the given ratio that fits inside a container. */
export function fitRect(containerW: number, containerH: number, ratio: number) {
  if (containerW <= 0 || containerH <= 0) return { width: 0, height: 0 };
  let width = containerW;
  let height = width / ratio;
  if (height > containerH) {
    height = containerH;
    width = height * ratio;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}
