import type { VideoSampleSink } from 'mediabunny';

// ---------------------------------------------------------------------------
// Colour-space matching between the preview and the export.
//
// The preview shows media through <video>; the export decodes with WebCodecs.
// For files without colour metadata (e.g. VP8/WebM from screen or camera
// recorders) Chrome's two paths can assume different YUV→RGB matrices, which
// shifts colours (measured: up to 16/255 on a red ramp). We calibrate once per
// source: decode one frame through both paths, try the plausible colour-space
// tags on the decoded frame, and keep the one that matches the <video> output.
// Export frames are re-tagged with it (a plane copy) only when it differs.
// ---------------------------------------------------------------------------

const CANDIDATES: (VideoColorSpaceInit | null)[] = [
  null, // as decoded
  { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false },
  { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true },
  { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: true },
];

const W = 96;
const H = 54;

/** Re-wraps a decoded frame with another colour-space tag (same planes). */
export async function retagFrame(frame: VideoFrame, colorSpace: VideoColorSpaceInit): Promise<VideoFrame> {
  const buf = new Uint8Array(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  return new VideoFrame(buf, {
    format: frame.format!,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    timestamp: frame.timestamp,
    duration: frame.duration ?? undefined,
    layout,
    colorSpace,
    visibleRect: frame.visibleRect ?? undefined,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
  });
}

function pixels(src: CanvasImageSource): Uint8ClampedArray {
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, W, H);
  return g.getImageData(0, 0, W, H).data;
}

const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / ((a.length / 4) * 3);
};

/**
 * Returns the colour space to re-tag decoded frames with so they match the
 * preview's <video> rendering, or null when the decoder's own tag already matches.
 */
export async function matchPreviewColorSpace(url: string, sink: VideoSampleSink, duration: number): Promise<VideoColorSpaceInit | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const t = Math.min(1, Math.max(0, duration / 2));
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  try {
    video.src = url;
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('load'));
    });
    video.currentTime = t;
    await new Promise<void>((res) => (video.onseeked = () => res()));
    const ref = pixels(video);
    const sample = await sink.getSample(t);
    if (!sample) return null;
    const frame = sample.toVideoFrame();
    try {
      let best: VideoColorSpaceInit | null = null;
      let bestScore = diff(ref, pixels(frame));
      for (const cs of CANDIDATES.slice(1) as VideoColorSpaceInit[]) {
        const f = await retagFrame(frame, cs);
        const score = diff(ref, pixels(f));
        f.close();
        // Require a clear improvement so uniform frames don't flip the choice.
        if (score < bestScore - 0.5) {
          bestScore = score;
          best = cs;
        }
      }
      return best;
    } finally {
      frame.close();
      sample.close();
    }
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
