import type { AspectRatio, ExportPreset, ExportResolution, ExportSettings, ExportVideoCodec, FrameRate } from '../../types';
import { aspectToNumber } from '../../utils/canvas';

export const EXPORT_RESOLUTIONS: { value: ExportResolution; label: string; shortSide: number }[] = [
  { value: '480p', label: '480p', shortSide: 480 },
  { value: '720p', label: '720p HD', shortSide: 720 },
  { value: '1080p', label: '1080p Full HD', shortSide: 1080 },
  { value: '1440p', label: '1440p QHD', shortSide: 1440 },
  { value: '2160p', label: '2160p 4K', shortSide: 2160 },
];

export const EXPORT_FRAME_RATES: FrameRate[] = [24, 25, 30, 50, 60];

export const VIDEO_CODEC_LABEL: Record<ExportVideoCodec, string> = { avc: 'H.264 (AVC)', hevc: 'H.265 (HEVC)' };

/** Output pixel size (even dimensions, short side = resolution). */
export function exportSize(aspect: AspectRatio, resolution: ExportResolution) {
  const shortSide = EXPORT_RESOLUTIONS.find((r) => r.value === resolution)!.shortSide;
  const ratio = aspectToNumber(aspect);
  const even = (n: number) => Math.round(n / 2) * 2;
  return ratio >= 1 ? { width: even(shortSide * ratio), height: shortSide } : { width: shortSide, height: even(shortSide / ratio) };
}

/** Bits per pixel per frame for each quality preset (H.264); HEVC needs ~40 % less. */
const BPP: Record<Exclude<ExportPreset, 'custom'>, number> = { draft: 0.05, standard: 0.1, high: 0.2 };

export function presetBitrate(preset: Exclude<ExportPreset, 'custom'>, w: number, h: number, fps: number, codec: ExportVideoCodec) {
  const bps = BPP[preset] * w * h * fps * (codec === 'hevc' ? 0.6 : 1);
  return Math.round(Math.min(120e6, Math.max(500e3, bps)) / 100e3) * 100e3;
}

export const PRESETS: { value: ExportPreset; label: string; description: string }[] = [
  { value: 'draft', label: 'Draft', description: '480p · low bitrate · fast, small file for review' },
  { value: 'standard', label: 'Standard', description: '1080p · balanced bitrate · AAC 160 kbps' },
  { value: 'high', label: 'High quality', description: '1080p · high bitrate · AAC 256 kbps' },
  { value: 'custom', label: 'Custom', description: 'Choose every setting yourself' },
];

/** Applies a preset (custom keeps the current values). */
export function applyPreset(s: ExportSettings, preset: ExportPreset, aspect: AspectRatio): ExportSettings {
  if (preset === 'custom') return { ...s, preset };
  const resolution: ExportResolution = preset === 'draft' ? '480p' : '1080p';
  const { width, height } = exportSize(aspect, resolution);
  return {
    ...s,
    preset,
    resolution,
    videoBitrate: presetBitrate(preset, width, height, s.frameRate, s.videoCodec),
    audioBitrate: preset === 'draft' ? 96_000 : preset === 'standard' ? 160_000 : 256_000,
  };
}

export function defaultExportSettings(projectName: string, fps: FrameRate, aspect: AspectRatio): ExportSettings {
  return applyPreset(
    { preset: 'standard', resolution: '1080p', frameRate: fps, videoCodec: 'avc', videoBitrate: 8e6, audioBitrate: 160_000, fileName: safeFileName(projectName) },
    'standard',
    aspect,
  );
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'export';

export const formatBitrate = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(bps >= 10e6 ? 0 : 1)} Mbps` : `${Math.round(bps / 1e3)} kbps`);
