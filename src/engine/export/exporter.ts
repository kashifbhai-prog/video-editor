import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';
import type { MediaItem, ProjectDocument, ExportSettings } from '../../types';
import { buildTimelineSequence, type Sequence, type SequenceItem } from '../sequence';
import { composeLayers, isItemActive, videoSampleTarget, type MediaContentProvider } from '../composition';
import { GLRenderer } from '../gl/glRenderer';
import { renderAudioMix } from './audioRender';
import { exportSize } from './exportSettings';
import { matchPreviewColorSpace, retagFrame } from './colorMatch';
import { matteEngine } from '../ai/matte';

// ---------------------------------------------------------------------------
// Export pipeline (all real, all in the browser):
//
//  1. Prepare  – build the same Sequence the preview plays; open every video
//                source with a demuxer + WebCodecs decoder (Mediabunny) for
//                frame-accurate random access; load images.
//  2. Audio    – offline mixdown (OfflineAudioContext, DSP in a worker).
//  3. Video    – for each output frame t = n / fps: decode the exact source
//                frame of every live clip, compose the layer stack with the
//                SHARED composition model, render it with the SAME WebGL
//                renderer as the preview, and hand the canvas to the
//                WebCodecs encoder (H.264 / HEVC, hardware when available).
//  4. Finalize – mux video + AAC/Opus audio into MP4 (fast-start).
//  5. Verify   – re-open the produced file, check duration, size and that its
//                first and last frames decode. Only then is it reported done.
// ---------------------------------------------------------------------------

export type ExportStage = 'prepare' | 'audio' | 'video' | 'finalize' | 'verify';

export interface ExportProgress {
  stage: ExportStage;
  /** 0..1 overall. */
  progress: number;
  frame: number;
  frames: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  size: number;
  /** Verified from the output file. */
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string | null;
  audioSkipped: { name: string; reason: string }[];
  hardwareEncoding: boolean;
  renderSeconds: number;
}

export class ExportError extends Error {}

const STAGE_WEIGHT = { prepare: 0.03, audio: 0.1, video: 0.82, finalize: 0.03, verify: 0.02 };
const STAGE_BASE = { prepare: 0, audio: 0.03, video: 0.13, finalize: 0.95, verify: 0.98 };

/** Yields to the event loop so the UI stays responsive (a macrotask, unlike await on a resolved promise). */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

interface DecodedFrame {
  source: VideoFrame | OffscreenCanvas;
  width: number;
  height: number;
  /** Source timestamp (seconds). */
  ts: number;
}

/** Per video clip: a monotonic stream of decoded frames for the output frames where the clip is live. */
class ClipFrames {
  private iter: AsyncGenerator<VideoSample | null, void, unknown>;
  private current: VideoSample | null = null;
  private retagged: VideoFrame | null = null;
  private frame: DecodedFrame | null = null;
  private pos = 0;
  constructor(
    sink: VideoSampleSink,
    private readonly frameIndices: number[],
    timestamps: number[],
    /** Colour space matching the preview (null = keep the decoder's tag). */
    private readonly colorSpace: VideoColorSpaceInit | null,
  ) {
    this.iter = sink.samplesAtTimestamps(timestamps);
  }
  /** Frame for output frame `n` (call with increasing n). */
  async at(n: number): Promise<DecodedFrame | null> {
    let advanced = false;
    while (this.pos < this.frameIndices.length && this.frameIndices[this.pos] <= n) {
      const r = await this.iter.next();
      this.release();
      this.current = r.done ? null : r.value;
      this.pos++;
      advanced = true;
    }
    if (advanced && this.current) {
      const s = this.current;
      if (this.colorSpace) {
        const vf = s.toVideoFrame();
        this.retagged = await retagFrame(vf, this.colorSpace);
        vf.close();
        this.frame = { source: this.retagged, width: s.displayWidth, height: s.displayHeight, ts: s.timestamp };
      } else {
        this.frame = { source: s.toCanvasImageSource(), width: s.displayWidth, height: s.displayHeight, ts: s.timestamp };
      }
    }
    return this.current ? this.frame : null;
  }
  private release() {
    this.retagged?.close();
    this.retagged = null;
    this.current?.close();
    this.current = null;
    this.frame = null;
  }
  close() {
    this.release();
    void this.iter.return(undefined);
  }
}

export async function runExport(opts: {
  doc: ProjectDocument;
  media: MediaItem[];
  settings: ExportSettings;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
  audioCodec: 'aac' | 'opus' | null;
}): Promise<ExportResult> {
  const { doc, settings, signal, onProgress } = opts;
  const t0 = performance.now();
  const fps = settings.frameRate;
  const { width, height } = exportSize(doc.canvas.aspectRatio, settings.resolution);
  const mediaById = new Map(opts.media.map((m) => [m.id, m]));
  const seq: Sequence = { ...buildTimelineSequence(doc, mediaById), fps };
  if (seq.duration <= 0) throw new ExportError('The timeline is empty – add clips before exporting.');
  const missing = Object.values(doc.clips).filter((c) => !c.text && mediaById.get(c.mediaId)?.status !== 'ready');
  if (missing.length) {
    throw new ExportError(`Some clips have missing or unreadable media: ${missing.slice(0, 4).map((c) => c.name).join(', ')}${missing.length > 4 ? '…' : ''}. Remove them or re-import the files.`);
  }
  const frames = Math.max(1, Math.ceil(seq.duration * fps - 1e-6));
  const outDuration = frames / fps;
  const report = (stage: ExportStage, within: number, frame = 0) =>
    onProgress({ stage, progress: STAGE_BASE[stage] + STAGE_WEIGHT[stage] * Math.min(1, within), frame, frames });

  const renderer = GLRenderer.create({ preserveDrawingBuffer: true });
  if (!renderer) throw new ExportError('WebGL2 is not available, so effects, colour grading and transitions cannot be rendered. Export needs WebGL2.');
  if (Math.max(width, height) > renderer.maxDimension) {
    renderer.dispose();
    throw new ExportError(`${width}×${height} exceeds this GPU's limit of ${renderer.maxDimension}px. Choose a lower resolution.`);
  }

  const inputs = new Map<string, Input>();
  const clipFrames = new Map<string, ClipFrames>();
  const images = new Map<string, HTMLImageElement>();
  const colorFix = new Map<string, VideoColorSpaceInit | null>();
  let output: Output | null = null;

  try {
    // ---- 1. Prepare ----------------------------------------------------------
    report('prepare', 0);
    const videoItems = seq.items.filter((it) => it.visible && it.media?.kind === 'video');
    for (let i = 0; i < videoItems.length; i++) {
      checkAbort(signal);
      const it = videoItems[i];
      const media = it.media!;
      let input = inputs.get(media.id);
      if (!input) {
        const blob = await (await fetch(media.url)).blob();
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        inputs.set(media.id, input);
      }
      const track = await input.getPrimaryVideoTrack().catch(() => null);
      if (!track) throw new ExportError(`"${media.name}" has no readable video track.`);
      if (!(await track.canDecode().catch(() => false))) {
        throw new ExportError(`"${media.name}" uses a codec (${track.codec ?? 'unknown'}) this browser cannot decode for export.`);
      }
      // Output frames where this clip is live, and the exact source time of each (shared rule).
      const idx: number[] = [];
      const ts: number[] = [];
      for (let n = 0; n < frames; n++) {
        const t = n / fps;
        if (!isItemActive(seq, it, t)) continue;
        idx.push(n);
        ts.push(videoSampleTarget(it, t, fps));
      }
      if (idx.length) {
        // Match the preview's colour conversion (calibrated once per source file).
        if (!colorFix.has(media.id)) colorFix.set(media.id, await matchPreviewColorSpace(media.url, new VideoSampleSink(track), media.duration ?? 1));
        clipFrames.set(it.clip.id, new ClipFrames(new VideoSampleSink(track), idx, ts, colorFix.get(media.id) ?? null));
      }
      report('prepare', (i + 1) / Math.max(1, videoItems.length));
    }
    // AI background removal: load the models first – a clip with background
    // removal is never exported without it.
    const matteModels = new Set(seq.items.filter((it) => it.visible && it.clip.matte?.enabled && it.media && it.media.kind !== 'audio').map((it) => it.clip.matte!.model));
    for (const m of matteModels) {
      checkAbort(signal);
      await matteEngine.load(m).catch((e) => {
        throw new ExportError(`The background-removal model could not be loaded (${e instanceof Error ? e.message : e}). Connect to the internet once so it can be downloaded, or turn background removal off.`);
      });
    }
    for (const it of seq.items) {
      if (it.media?.kind !== 'image' || images.has(it.media.url)) continue;
      const img = new Image();
      img.src = it.media.url;
      await img.decode().catch(() => {
        throw new ExportError(`The image "${it.media!.name}" could not be decoded.`);
      });
      images.set(it.media.url, img);
    }

    // ---- 2. Audio --------------------------------------------------------------
    checkAbort(signal);
    report('audio', 0);
    const hasAudioClips = seq.items.some((it) => it.media && it.media.kind !== 'image' && it.audible);
    let mix: Awaited<ReturnType<typeof renderAudioMix>> | null = null;
    if (hasAudioClips && opts.audioCodec) {
      mix = await renderAudioMix(seq, outDuration, signal, (f) => report('audio', f));
    }

    // ---- Output -----------------------------------------------------------------
    const codec = settings.videoCodec;
    const hardware = await canEncodeVideo(codec, { width, height, frameRate: fps, bitrate: settings.videoBitrate, hardwareAcceleration: 'prefer-hardware' }).catch(() => false);
    const softwareOk = hardware || (await canEncodeVideo(codec, { width, height, frameRate: fps, bitrate: settings.videoBitrate }).catch(() => false));
    if (!softwareOk) throw new ExportError(`This browser cannot encode ${codec === 'avc' ? 'H.264' : 'HEVC'} at ${width}×${height}. Choose another resolution or codec.`);

    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    renderer.canvas.width = width;
    renderer.canvas.height = height;
    const videoSource = new CanvasSource(renderer.canvas, {
      codec,
      bitrate: settings.videoBitrate,
      keyFrameInterval: 2,
      latencyMode: 'quality',
      hardwareAcceleration: hardware ? 'prefer-hardware' : 'no-preference',
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (mix && opts.audioCodec) {
      audioSource = new AudioBufferSource({ codec: opts.audioCodec, bitrate: settings.audioBitrate });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    if (audioSource && mix) {
      await audioSource.add(mix.buffer);
      audioSource.close();
    }

    // ---- 3. Video ---------------------------------------------------------------
    const provider = (n: number, samples: Map<string, DecodedFrame | null>): MediaContentProvider => (it: SequenceItem) => {
      const media = it.media!;
      if (media.kind === 'image') {
        const img = images.get(media.url);
        return img ? { type: 'media', source: img, width: img.naturalWidth, height: img.naturalHeight, dynamic: false, frameKey: media.id } : null;
      }
      const s = samples.get(it.clip.id);
      if (!s) return null;
      return {
        type: 'media',
        source: s.source,
        width: s.width,
        height: s.height,
        dynamic: true,
        key: `${it.clip.id}#${n % 2}`,
        frameKey: `${media.id}@${s.ts.toFixed(3)}`,
      };
    };

    for (let n = 0; n < frames; n++) {
      checkAbort(signal);
      const t = n / fps;
      const samples = new Map<string, DecodedFrame | null>();
      for (const [id, cf] of clipFrames) {
        const it = seq.items.find((x) => x.clip.id === id)!;
        if (isItemActive(seq, it, t)) samples.set(id, await cf.at(n));
      }
      const layers = composeLayers(seq, t, provider(n, samples), { strictMatte: true });
      if (!renderer.render({ width, height, background: doc.canvas.backgroundColor, layers })) {
        throw new ExportError('The GPU context was lost during rendering (often low graphics memory). Try a lower resolution.');
      }
      await videoSource.add(t, 1 / fps);
      report('video', (n + 1) / frames, n + 1);
      if (n % 2 === 0) await yieldToUi();
    }
    videoSource.close();

    // ---- 4. Finalize ---------------------------------------------------------------
    checkAbort(signal);
    report('finalize', 0);
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) throw new ExportError('The encoder produced no data.');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    output = null;

    // ---- 5. Verify -----------------------------------------------------------------
    report('verify', 0);
    const verified = await verifyOutput(blob);
    if (Math.abs(verified.width - width) > 1 || Math.abs(verified.height - height) > 1) {
      throw new ExportError(`Verification failed: output is ${verified.width}×${verified.height}, expected ${width}×${height}.`);
    }
    if (Math.abs(verified.duration - outDuration) > 2 / fps + 0.05) {
      throw new ExportError(`Verification failed: output lasts ${verified.duration.toFixed(2)} s, expected ${outDuration.toFixed(2)} s.`);
    }
    if (mix && !verified.audioCodec) throw new ExportError('Verification failed: the output has no audio track.');
    report('verify', 1);
    return {
      blob,
      fileName: `${settings.fileName}.mp4`,
      size: blob.size,
      duration: verified.duration,
      width: verified.width,
      height: verified.height,
      frameRate: fps,
      videoCodec: verified.videoCodec,
      audioCodec: verified.audioCodec,
      audioSkipped: mix?.skipped ?? [],
      hardwareEncoding: hardware,
      renderSeconds: (performance.now() - t0) / 1000,
    };
  } catch (err) {
    if (output) await output.cancel().catch(() => undefined);
    throw friendlyError(err);
  } finally {
    clipFrames.forEach((c) => c.close());
    inputs.forEach((i) => i.dispose());
    renderer.dispose();
  }
}

/** Re-opens the produced file and checks it really is a playable video. */
export async function verifyOutput(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new ExportError('Verification failed: the output has no video track.');
    const at = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const sink = new VideoSampleSink(vt);
    const first = await sink.getSample(0);
    const last = await sink.getSample(Math.max(0, duration - 0.001));
    if (!first || !last) throw new ExportError('Verification failed: frames of the output could not be decoded.');
    first.close();
    last.close();
    return {
      duration,
      width: vt.displayWidth,
      height: vt.displayHeight,
      videoCodec: (await vt.getCodecParameterString()) ?? vt.codec ?? 'video',
      audioCodec: at ? ((await at.getCodecParameterString()) ?? at.codec ?? 'audio') : null,
    };
  } finally {
    input.dispose();
  }
}

function friendlyError(err: unknown): Error {
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  if (err instanceof ExportError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof RangeError || /memory|allocation|quota/i.test(msg)) {
    return new ExportError(`The browser ran out of memory while exporting. Try a lower resolution or a shorter export. (${msg})`);
  }
  if (/codec|encoder|decoder|configure/i.test(msg)) return new ExportError(`Encoding failed: ${msg}`);
  return new ExportError(`Export failed: ${msg}`);
}
