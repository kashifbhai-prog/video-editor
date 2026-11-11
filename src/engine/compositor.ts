import type { ClipEffect, ColorAdjustments, CropRect, FitMode, MatteMode, TextData, TransitionType } from '../types';
import type { ResolvedVisual } from './animation';
import { getTextBitmap, TEXT_REFERENCE_HEIGHT } from './textRenderer';

// ---------------------------------------------------------------------------
// Compositor layer model + geometry, shared by the WebGL renderer
// (engine/gl/glRenderer.ts), the 2D fallback below and the preview's
// transform handles. Geometry is resolution-independent: positions are
// fractions of the canvas and text sizes are authored at 1080p, so a project
// renders identically at any preview quality or export size.
// ---------------------------------------------------------------------------

export type LayerContent =
  | {
      type: 'media';
      /** Preview: live <video>/<img>. Export: decoded VideoFrame / OffscreenCanvas / <img>. */
      source: HTMLVideoElement | HTMLImageElement | VideoFrame | OffscreenCanvas | HTMLCanvasElement;
      width: number;
      height: number;
      /** Video: re-upload every frame. */
      dynamic: boolean;
      /** Texture cache key when the source object changes every frame (decoded frames). */
      key?: string;
      /** Identity of the SOURCE frame shown (media id + source time) – keys per-frame AI masks. */
      frameKey?: string;
    }
  | { type: 'text'; text: TextData; visibleChars: number | null };

export interface VisualLayer {
  kind: 'visual';
  clipId: string;
  content: LayerContent;
  fit: FitMode;
  crop: CropRect | null;
  t: ResolvedVisual;
  /** Effective grade (colour adjustments + filter preset × intensity), null = neutral. */
  grade: Grade | null;
  /** Enabled effects only, in application order. */
  effects: ClipEffect[];
  /** Anchor velocity in canvas fractions per second (motion blur). */
  velocity: { x: number; y: number };
  /** Timeline seconds – seeds animated effects (noise, grain, glitch) deterministically. */
  time: number;
  fps: number;
  /** AI background removal: the person mask of this frame + how to replace the background. */
  matte?: LayerMatte;
}

export interface LayerMatte {
  /** Greyscale person confidence (R channel), covering the full source frame. */
  mask: ImageData;
  key: string;
  mode: MatteMode;
  color: string;
  threshold: number;
  feather: number;
  blur: number;
}

export interface Grade {
  adjust: ColorAdjustments;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
}

export interface TransitionLayer {
  kind: 'transition';
  type: TransitionType;
  /** 0 → 1 across the transition window. */
  progress: number;
  from: VisualLayer | null;
  to: VisualLayer | null;
}

export interface AudioLayer {
  kind: 'audio';
  waveform?: number[];
  progress: number;
  label: string;
}

export type CompositorLayer = VisualLayer | TransitionLayer | AudioLayer;

export interface CompositorFrame {
  width: number;
  height: number;
  background: string;
  /** Bottom-most first. */
  layers: CompositorLayer[];
}

/** Where a layer lands on the canvas, in canvas pixels (y down). */
export interface LayerGeometry {
  /** The anchor point on the canvas. */
  origin: { x: number; y: number };
  /** Full (uncropped) box size, after fit and scale. */
  boxW: number;
  boxH: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
  crop: CropRect;
}

export const NO_CROP: CropRect = { left: 0, top: 0, right: 0, bottom: 0 };

/** Natural size of a text box in reference units (cached bitmap metrics). */
export function textLogicalSize(text: TextData) {
  const b = getTextBitmap(text, null, 0.25);
  return { w: b.logicalWidth, h: b.logicalHeight };
}

export function layerGeometry(layer: VisualLayer, W: number, H: number): LayerGeometry {
  const { t } = layer;
  let boxW: number;
  let boxH: number;
  if (layer.content.type === 'text') {
    const size = textLogicalSize(layer.content.text);
    const k = (H / TEXT_REFERENCE_HEIGHT) * t.scale;
    boxW = size.w * k;
    boxH = size.h * k;
  } else {
    const { width: w, height: h } = layer.content;
    const fit = (layer.fit === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h)) * t.scale;
    boxW = w * fit;
    boxH = h * fit;
  }
  return {
    origin: { x: W / 2 + t.x * W, y: H / 2 + t.y * H },
    boxW,
    boxH,
    rotation: t.rotation,
    anchorX: t.anchorX,
    anchorY: t.anchorY,
    crop: layer.crop ?? NO_CROP,
  };
}

/** Maps a point in box fractions (u right, v down; 0..1) to canvas pixels. */
export function boxToCanvas(g: LayerGeometry, u: number, v: number) {
  const rad = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = (u - g.anchorX) * g.boxW;
  const ly = (v - g.anchorY) * g.boxH;
  return { x: g.origin.x + lx * cos - ly * sin, y: g.origin.y + lx * sin + ly * cos };
}

/** Inverse of boxToCanvas. */
export function canvasToBox(g: LayerGeometry, x: number, y: number) {
  const rad = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - g.origin.x;
  const dy = y - g.origin.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return { u: lx / g.boxW + g.anchorX, v: ly / g.boxH + g.anchorY };
}

// ---- 2D fallback (no WebGL2) ----------------------------------------------------------
// Transforms, crop, opacity, text and transitions (as a crossfade) only:
// colour grading and effects need the WebGL renderer.

export function renderFrame2D(ctx: CanvasRenderingContext2D, frame: CompositorFrame) {
  const { width, height, background, layers } = frame;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  for (const layer of layers) {
    if (layer.kind === 'audio') drawAudioVisual(ctx, width, height, layer);
    else if (layer.kind === 'visual') drawVisual2D(ctx, layer, width, height, 1);
    else {
      if (layer.from) drawVisual2D(ctx, layer.from, width, height, 1 - layer.progress);
      if (layer.to) drawVisual2D(ctx, layer.to, width, height, layer.progress);
    }
  }
  ctx.restore();
}

function drawVisual2D(ctx: CanvasRenderingContext2D, layer: VisualLayer, W: number, H: number, alphaMul: number) {
  const alpha = layer.t.opacity * alphaMul;
  if (alpha <= 0) return;
  const g = layerGeometry(layer, W, H);
  if (g.boxW <= 0 || g.boxH <= 0) return;
  let source: CanvasImageSource;
  let sw: number;
  let sh: number;
  if (layer.content.type === 'text') {
    const bmp = getTextBitmap(layer.content.text, layer.content.visibleChars, (H / TEXT_REFERENCE_HEIGHT) * Math.max(0.1, layer.t.scale));
    source = bmp.canvas;
    sw = bmp.canvas.width;
    sh = bmp.canvas.height;
  } else {
    source = layer.content.source;
    sw = layer.content.width;
    sh = layer.content.height;
  }
  const c = g.crop;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(g.origin.x, g.origin.y);
  ctx.rotate((g.rotation * Math.PI) / 180);
  ctx.translate(-g.anchorX * g.boxW, -g.anchorY * g.boxH);
  // Crop is in displayed (post-flip) space; flip the drawing inside the box.
  const dx = c.left * g.boxW;
  const dy = c.top * g.boxH;
  const dw = (1 - c.left - c.right) * g.boxW;
  const dh = (1 - c.top - c.bottom) * g.boxH;
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.translate(layer.t.flipH ? g.boxW : 0, layer.t.flipV ? g.boxH : 0);
  ctx.scale(layer.t.flipH ? -1 : 1, layer.t.flipV ? -1 : 1);
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, g.boxW, g.boxH);
  ctx.restore();
}

export function drawAudioVisual(ctx: CanvasRenderingContext2D, width: number, height: number, layer: AudioLayer) {
  const peaks = layer.waveform?.length ? layer.waveform : Array.from({ length: 64 }, () => 0.15);
  const areaW = width * 0.7;
  const areaH = height * 0.3;
  const x0 = (width - areaW) / 2;
  const cy = height / 2;
  const barW = areaW / peaks.length;
  const played = Math.floor(peaks.length * layer.progress);

  peaks.forEach((p, i) => {
    const h = Math.max(2, p * areaH);
    ctx.fillStyle = i < played ? '#7d8bff' : 'rgba(255,255,255,0.28)';
    ctx.fillRect(x0 + i * barW + barW * 0.15, cy - h / 2, barW * 0.7, h);
  });

  const fontSize = Math.max(12, Math.round(height * 0.035));
  ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = layer.label.length > 60 ? `${layer.label.slice(0, 57)}...` : layer.label;
  ctx.fillText(label, width / 2, cy + areaH / 2 + fontSize);
}
