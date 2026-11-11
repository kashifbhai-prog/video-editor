import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { ClipMatte } from '../../types';

// ---------------------------------------------------------------------------
// AI background removal: MediaPipe selfie segmentation (on-device; WebGL
// accelerated where available). Produces a person-confidence mask per source
// frame, which the shared compositor applies in its WebGL pipeline – the same
// code path for the live preview and the export.
//
// Masks are cached per source frame (`frameKey`), so a paused preview, the
// two halves of a transition, or repeated renders never re-run the model.
// Models are downloaded once from Google's model storage and kept in the
// browser's Cache Storage; the WebAssembly runtime ships with the app.
// ---------------------------------------------------------------------------

export type MatteModel = ClipMatte['model'];

const MODEL_URL: Record<MatteModel, string> = {
  fast: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  quality: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
};
export const MATTE_MODEL_MB: Record<MatteModel, number> = { fast: 0.25, quality: 16 };
const MODEL_CACHE = 'reelforge-ai-models-v1';
/** Longest side of the image handed to the model (its own input is 256 px). */
const SEG_MAX = 512;
const CACHE_SIZE = 12;

export interface MatteMask {
  key: string;
  image: ImageData;
}

export const DEFAULT_MATTE: ClipMatte = {
  enabled: true,
  mode: 'transparent',
  color: '#1f8f4e',
  model: 'quality',
  threshold: 0.5,
  feather: 0.35,
  blur: 0.6,
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Downloads a model once; later loads come from Cache Storage (works offline). */
async function cachedModel(url: string, onProgress?: (f: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null; // Cache Storage unavailable (private mode): download every session
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  try {
    await cache?.put(url, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    /* quota: fine, just not cached */
  }
  return bytes;
}

class MatteEngine {
  private segmenters = new Map<MatteModel, ImageSegmenter>();
  private loading = new Map<MatteModel, Promise<void>>();
  private status = new Map<MatteModel, Status>();
  private errors = new Map<MatteModel, string>();
  private cache = new Map<string, MatteMask>();
  private listeners = new Set<() => void>();
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private delegate: 'GPU' | 'CPU' = 'GPU';

  statusOf(model: MatteModel): Status {
    return this.status.get(model) ?? 'idle';
  }
  errorOf(model: MatteModel) {
    return this.errors.get(model);
  }
  /** Notified when a model finishes loading (the preview redraws with masks). */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  load(model: MatteModel, onProgress?: (f: number) => void): Promise<void> {
    let p = this.loading.get(model);
    if (p) return p;
    this.status.set(model, 'loading');
    this.emit();
    p = (async () => {
      const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const buffer = await cachedModel(MODEL_URL[model], onProgress);
      const fileset = { wasmLoaderPath: new URL(wasmLoaderPath, location.href).href, wasmBinaryPath: new URL(wasmBinaryPath, location.href).href };
      const create = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: buffer, delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      let seg: ImageSegmenter;
      try {
        seg = await create(this.delegate);
      } catch (e) {
        if (this.delegate === 'CPU') throw e;
        this.delegate = 'CPU'; // no usable WebGL for MediaPipe: run on the CPU
        seg = await create('CPU');
      }
      this.segmenters.set(model, seg);
      this.status.set(model, 'ready');
      this.emit();
    })().catch((e) => {
      this.loading.delete(model);
      this.status.set(model, 'error');
      this.errors.set(model, e instanceof Error ? e.message : String(e));
      this.emit();
      throw e;
    });
    this.loading.set(model, p);
    return p;
  }

  isReady(model: MatteModel) {
    return this.segmenters.has(model);
  }

  /**
   * Person mask for one source frame (synchronous; null while the model is not
   * loaded yet – the caller starts loading). Cached by `frameKey`.
   */
  mask(model: MatteModel, frameKey: string, source: CanvasImageSource, width: number, height: number): MatteMask | null {
    const key = `${model}|${frameKey}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const seg = this.segmenters.get(model);
    if (!seg) {
      if (this.statusOf(model) === 'idle') void this.load(model).catch(() => {});
      return null;
    }
    // Output mask resolution (frame aspect, longest side ≤ SEG_MAX).
    const k = Math.min(1, SEG_MAX / Math.max(width, height));
    const w = Math.max(8, Math.round(width * k));
    const h = Math.max(8, Math.round(height * k));
    const prob = new Float32Array(w * h);

    // Pass 1: the whole frame. Pass 2 (small subjects): a zoomed crop around the
    // person, so hair and edges get the model's full input resolution.
    const ok = this.pass(seg, source, { x: 0, y: 0, w: width, h: height }, width, height, prob, w, h);
    if (!ok) return null;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (prob[y * w + x] < 0.5) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0 && (x1 - x0) * (y1 - y0) < w * h * 0.45) {
      const pad = 0.25 * Math.max(x1 - x0, y1 - y0);
      const cx0 = Math.max(0, x0 - pad);
      const cy0 = Math.max(0, y0 - pad);
      const cx1 = Math.min(w, x1 + pad);
      const cy1 = Math.min(h, y1 + pad);
      this.pass(seg, source, { x: cx0 / k, y: cy0 / k, w: (cx1 - cx0) / k, h: (cy1 - cy0) / k }, width, height, prob, w, h, true);
    }
    const img = new ImageData(w, h);
    const d = img.data;
    for (let i = 0; i < prob.length; i++) {
      const v = Math.round(prob[i] * 255);
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    const m = { key, image: img };
    this.cache.set(key, m);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return m;
  }

  /**
   * Runs the model on a source rectangle, letterboxed into the square model
   * input (no squashing), and writes person probabilities into `prob` (the
   * w×h output grid covering the whole frame). `onlyInside`: pass 2 – only the
   * rectangle is updated.
   */
  private pass(seg: ImageSegmenter, source: CanvasImageSource, r: { x: number; y: number; w: number; h: number }, fw: number, fh: number, prob: Float32Array, w: number, h: number, onlyInside = false): boolean {
    const S = SEG_MAX;
    const k = S / Math.max(r.w, r.h);
    const dw = r.w * k;
    const dh = r.h * k;
    const ox = (S - dw) / 2;
    const oy = (S - dh) / 2;
    if (!this.canvas || this.canvas.width !== S) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : Object.assign(document.createElement('canvas'), { width: S, height: S });
    }
    const g = this.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.drawImage(source, r.x, r.y, r.w, r.h, ox, oy, dw, dh);
    const result = seg.segment(this.canvas as unknown as HTMLCanvasElement);
    try {
      const masks = result.confidenceMasks ?? [];
      if (!masks.length) return false;
      const mw = masks[0].width;
      const mh = masks[0].height;
      // fast: one "person" mask. quality: 6 classes, class 0 = background.
      const conf = masks[0].getAsFloat32Array();
      const person = masks.length === 1;
      const gx = fw / w;
      const gy = fh / h;
      for (let y = 0; y < h; y++) {
        const sy = (y + 0.5) * gy; // source pixel
        if (onlyInside && (sy < r.y || sy >= r.y + r.h)) continue;
        const my = Math.min(mh - 1, Math.max(0, Math.floor(((sy - r.y) * k + oy) * (mh / S))));
        for (let x = 0; x < w; x++) {
          const sx = (x + 0.5) * gx;
          if (onlyInside && (sx < r.x || sx >= r.x + r.w)) continue;
          const mx = Math.min(mw - 1, Math.max(0, Math.floor(((sx - r.x) * k + ox) * (mw / S))));
          const c = conf[my * mw + mx];
          prob[y * w + x] = person ? c : 1 - c;
        }
      }
      return true;
    } finally {
      result.close();
    }
  }

  /** Frees the models (memory) – they load again from the cache when needed. */
  dispose() {
    this.segmenters.forEach((s) => s.close());
    this.segmenters.clear();
    this.loading.clear();
    this.status.clear();
    this.cache.clear();
    this.emit();
  }
}

export const matteEngine = new MatteEngine();
