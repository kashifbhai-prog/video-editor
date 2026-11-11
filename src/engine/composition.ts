import type { LayerContent, TransitionLayer, VisualLayer } from './compositor';
import type { Sequence, SequenceItem } from './sequence';
import { resolveVisual } from './animation';
import { effectiveGrade } from './grade';
import { sourceTimeAt } from './timelineModel';
import { matteEngine } from './ai/matte';

// ---------------------------------------------------------------------------
// Shared composition model: which items are live at time t, which source
// frame each shows, and the layer stack to composite. The preview engine and
// the export renderer both call these – only the media frame provider differs
// (live <video> elements vs. frame-accurate decoded samples) – so the export
// reproduces exactly what the preview composes.
// ---------------------------------------------------------------------------

export const ACTIVE_EPS = 1e-4;

/** Live (rendered / playing) at time t – the clip's range widened by transitions. */
export const isItemActive = (seq: Sequence, it: SequenceItem, t: number) =>
  seq.still || (t >= it.renderStart - ACTIVE_EPS && t < it.renderEnd - ACTIVE_EPS);

/**
 * Video frames are sampled at the CENTRE of each output frame (t + ½ frame):
 * frame n covers [n, n+1)/fps and shows the source frame on screen at its
 * middle. Sampling at the frame start would pick the previous source frame
 * whenever source timestamps sit slightly after the grid (common in recorded
 * media) – a one-frame lag measured on real recordings. Audio is unaffected.
 */
export const frameCentre = (t: number, fps: number) => t + 0.5 / (fps || 30);

/** Source time to show for a video item in the output frame starting at t (centre-sampled, kept inside the clip). */
export const videoSampleTarget = (it: SequenceItem, t: number, fps: number) =>
  sourceTarget(it, Math.min(frameCentre(t, fps), it.renderEnd - 1e-4)).target;

/**
 * Source position for an item at time t, clamped to the media. `frozen`: hold
 * a frame instead of playing (outside the media's range during a transition,
 * or a reversed clip – browsers can't play backwards).
 */
export function sourceTarget(it: SequenceItem, t: number) {
  const held = it.holdFrom !== undefined && t >= it.holdFrom;
  const raw = sourceTimeAt(it.clip, held ? it.holdFrom! : t);
  const end = Math.max(0, (it.media?.duration ?? Infinity) - 1e-3);
  const target = Math.min(end, Math.max(0, raw));
  return { target, frozen: held || !!it.clip.reversed || raw < -1e-6 || raw > end + 1e-6 };
}

/** Media frame for an image / video item at time t, or null when none is available. */
export type MediaContentProvider = (it: SequenceItem, t: number) => Extract<LayerContent, { type: 'media' }> | null;

/** Builds the visual layer of one item (text, or media via the provider). */
export interface ComposeOptions {
  /** Export: a background-removal mask that cannot be produced is an error, never silently skipped. */
  strictMatte?: boolean;
}

export function visualLayerFor(seq: Sequence, it: SequenceItem, t: number, media: MediaContentProvider, opts: ComposeOptions = {}): VisualLayer | null {
  const clip = it.clip;
  const fps = seq.fps || 30;
  let content: LayerContent;
  if (clip.text) content = { type: 'text', text: clip.text, visibleChars: null };
  else if (!it.media || it.media.kind === 'audio') return null;
  else {
    const m = media(it, t);
    if (!m) return null;
    content = m;
  }
  const tr = resolveVisual(clip, t);
  if (content.type === 'text') content.visibleChars = tr.visibleChars;
  // AI background removal (same mask + shader in the preview and the export).
  let matte: VisualLayer['matte'];
  const mc = clip.matte;
  if (mc?.enabled && content.type === 'media' && content.frameKey) {
    const m = matteEngine.mask(mc.model, content.frameKey, content.source as CanvasImageSource, content.width, content.height);
    if (m) matte = { mask: m.image, key: m.key, mode: mc.mode, color: mc.color, threshold: mc.threshold, feather: mc.feather, blur: mc.blur };
    else if (opts.strictMatte) throw new Error(`Background removal could not process "${clip.name}".`);
  }
  // Anchor velocity (canvas fractions / second) for motion blur.
  const prev = resolveVisual(clip, t - 1 / fps);
  return {
    kind: 'visual',
    clipId: clip.id,
    content,
    fit: clip.fit ?? 'contain',
    crop: clip.crop ?? null,
    t: tr,
    grade: effectiveGrade(clip),
    effects: (clip.effects ?? []).filter((e) => e.enabled),
    velocity: { x: (tr.x - prev.x) * fps, y: (tr.y - prev.y) * fps },
    time: t,
    fps,
    ...(matte ? { matte } : {}),
  };
}

/** The layer stack at time t, bottom-most first, with transitions grouped. */
export function composeLayers(seq: Sequence, t: number, media: MediaContentProvider, opts: ComposeOptions = {}): (VisualLayer | TransitionLayer)[] {
  const layers: (VisualLayer | TransitionLayer)[] = [];
  const byClip = new Map<string, VisualLayer>();
  for (const it of seq.items) {
    if (!it.visible || !isItemActive(seq, it, t)) continue;
    const layer = visualLayerFor(seq, it, t, media, opts);
    if (!layer) continue;
    layers.push(layer);
    byClip.set(it.clip.id, layer);
  }
  // Replace each active transition's two clips with one transition layer (at the clips' depth).
  for (const tr of seq.transitions) {
    if (t < tr.start || t >= tr.end) continue;
    const from = byClip.get(tr.fromId) ?? null;
    const to = byClip.get(tr.toId) ?? null;
    if (!from && !to) continue;
    const group: TransitionLayer = { kind: 'transition', type: tr.type, progress: (t - tr.start) / (tr.end - tr.start), from, to };
    const at = layers.findIndex((l) => l === from || l === to);
    const rest = layers.filter((l) => l !== from && l !== to);
    rest.splice(Math.min(at, rest.length), 0, group);
    layers.length = 0;
    layers.push(...rest);
  }
  return layers;
}
