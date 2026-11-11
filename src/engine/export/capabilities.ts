import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { AspectRatio, ExportResolution, ExportVideoCodec, FrameRate } from '../../types';
import { GLRenderer } from '../gl/glRenderer';
import { EXPORT_RESOLUTIONS, exportSize } from './exportSettings';

// ---------------------------------------------------------------------------
// What this browser can actually export. Every option shown in the export
// dialog is checked against the real WebCodecs encoder and the GPU limits.
// ---------------------------------------------------------------------------

export interface ResolutionSupport {
  resolution: ExportResolution;
  width: number;
  height: number;
  supported: boolean;
  reason?: string;
}

export interface ExportCapabilities {
  webCodecs: boolean;
  webgl2: boolean;
  maxDimension: number;
  /** Per codec, per resolution. */
  video: Record<ExportVideoCodec, ResolutionSupport[]>;
  /** First supported of AAC → Opus (both valid in MP4), or null. */
  audioCodec: 'aac' | 'opus' | null;
  /** Hardware encoding is available for H.264 at 1080p. */
  hardwareAvc: boolean;
}

let maxDimCache: number | null = null;
function gpuMaxDimension(): number {
  if (maxDimCache !== null) return maxDimCache;
  const r = GLRenderer.create();
  maxDimCache = r ? r.maxDimension : 0;
  r?.dispose();
  return maxDimCache;
}

export async function probeExportCapabilities(aspect: AspectRatio, fps: FrameRate): Promise<ExportCapabilities> {
  const webCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  const maxDimension = gpuMaxDimension();
  const webgl2 = maxDimension > 0;
  const video = { avc: [] as ResolutionSupport[], hevc: [] as ResolutionSupport[] };
  for (const codec of ['avc', 'hevc'] as const) {
    for (const r of EXPORT_RESOLUTIONS) {
      const { width, height } = exportSize(aspect, r.value);
      let supported = false;
      let reason: string | undefined;
      if (!webCodecs) reason = 'WebCodecs is not available in this browser';
      else if (!webgl2) reason = 'WebGL2 is not available';
      else if (Math.max(width, height) > maxDimension) reason = `GPU limit is ${maxDimension}px`;
      else {
        try {
          supported = await canEncodeVideo(codec, { width, height, frameRate: fps, bitrate: 8e6 });
        } catch {
          supported = false;
        }
        if (!supported) reason = `This browser's ${codec === 'avc' ? 'H.264' : 'HEVC'} encoder does not support ${width}×${height}`;
      }
      video[codec].push({ resolution: r.value, width, height, supported, reason });
    }
  }
  let audioCodec: ExportCapabilities['audioCodec'] = null;
  if (typeof AudioEncoder !== 'undefined') {
    for (const c of ['aac', 'opus'] as const) {
      if (await canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000, bitrate: 160_000 }).catch(() => false)) {
        audioCodec = c;
        break;
      }
    }
  }
  const hardwareAvc =
    webCodecs &&
    (await canEncodeVideo('avc', { width: 1920, height: 1080, frameRate: fps, bitrate: 8e6, hardwareAcceleration: 'prefer-hardware' }).catch(() => false));
  return { webCodecs, webgl2, maxDimension, video, audioCodec, hardwareAvc };
}
