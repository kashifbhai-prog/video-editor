import type { TextData, TextStyle } from '../types';

// ---------------------------------------------------------------------------
// Text rasteriser: draws a text clip into an offscreen 2D canvas (Unicode,
// RTL-aware, outline, shadow, background box, letter / line spacing). The
// result is uploaded as a texture by the renderer. Bitmaps are cached; the
// cache key includes everything that affects the pixels.
// ---------------------------------------------------------------------------

/** Text sizes are authored for a 1080-pixel-high canvas. */
export const TEXT_REFERENCE_HEIGHT = 1080;

export interface TextBitmap {
  canvas: HTMLCanvasElement;
  /** Box size in reference (1080p) units – independent of render resolution. */
  logicalWidth: number;
  logicalHeight: number;
}

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const isRtlText = (s: string) => RTL_CHARS.test(s);

export function resolvedDirection(text: TextData): 'ltr' | 'rtl' {
  if (text.style.direction !== 'auto') return text.style.direction;
  return isRtlText(text.content) ? 'rtl' : 'ltr';
}

const fontSpec = (s: TextStyle, px: number) => `${s.italic ? 'italic ' : ''}${s.fontWeight} ${px}px "${s.fontFamily}", "Segoe UI", Tahoma, sans-serif`;

const MAX_CACHE = 48;
const cache = new Map<string, TextBitmap>();
const pendingFonts = new Set<string>();
let onInvalidate: (() => void) | null = null;

/** Called when a web font finishes loading (text must be re-rasterised). */
export function setTextInvalidateListener(fn: (() => void) | null) {
  onInvalidate = fn;
}

function ensureFont(style: TextStyle) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const spec = fontSpec(style, 40);
  if (pendingFonts.has(spec)) return;
  try {
    if (document.fonts.check(spec)) return;
  } catch {
    return;
  }
  pendingFonts.add(spec);
  document.fonts
    .load(spec)
    .then((faces) => {
      if (!faces.length) return; // not a web font: the fallback is final
      cache.clear();
      onInvalidate?.();
    })
    .catch(() => undefined);
}

/** Splits into user-perceived characters so typewriter never cuts a grapheme (e.g. emoji, Arabic marks). */
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

export const textLength = (content: string) => graphemes(content).length;

/**
 * Rasterises `text` at `pxScale` (render pixels per reference unit). The box is
 * measured from the FULL text, so a typewriter animation does not resize it.
 */
export function getTextBitmap(text: TextData, visibleChars: number | null, pxScale: number): TextBitmap {
  const scale = Math.max(0.05, Math.round(pxScale * 1000) / 1000);
  const key = `${scale}|${visibleChars ?? -1}|${text.content}|${JSON.stringify(text.style)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // LRU touch
    return hit;
  }
  ensureFont(text.style);
  const bmp = rasterise(text, visibleChars, scale);
  cache.set(key, bmp);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return bmp;
}

function rasterise(text: TextData, visibleChars: number | null, scale: number): TextBitmap {
  const s = text.style;
  const size = s.fontSize;
  const dir = resolvedDirection(text);
  const lines = text.content.split('\n');
  const measureCanvas = document.createElement('canvas');
  const m = measureCanvas.getContext('2d')!;
  m.font = fontSpec(s, size);
  setSpacing(m, s.letterSpacing);
  m.direction = dir;

  const widths = lines.map((l) => (l ? m.measureText(l).width : 0));
  const textW = Math.max(1, ...widths);
  const lineH = size * s.lineHeight;
  const textH = Math.max(lineH, lineH * lines.length);
  const shadowPad = s.shadowBlur > 0 ? s.shadowBlur * 1.5 + Math.max(Math.abs(s.shadowOffsetX), Math.abs(s.shadowOffsetY)) : 0;
  const pad = Math.ceil(Math.max(s.background ? size * 0.35 : size * 0.12, s.outlineWidth, shadowPad));
  const logicalWidth = textW + pad * 2;
  const logicalHeight = textH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(logicalWidth * scale));
  canvas.height = Math.max(1, Math.ceil(logicalHeight * scale));
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);

  if (s.background) {
    g.fillStyle = s.background;
    roundRect(g, 0, 0, logicalWidth, logicalHeight, Math.min(size * 0.2, logicalHeight / 2));
    g.fill();
  }

  // Typewriter: reveal characters in logical order (right-to-left scripts reveal from the right).
  let remaining = visibleChars ?? Infinity;
  const shown = lines.map((l) => {
    const chars = graphemes(l);
    const take = Math.max(0, Math.min(chars.length, remaining));
    remaining -= chars.length + 1; // the newline counts as one character
    return chars.slice(0, take).join('');
  });

  g.font = fontSpec(s, size);
  setSpacing(g, s.letterSpacing);
  g.direction = dir;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  // In RTL the "start" of a partially revealed line is its right edge, so draw
  // relative to the full line's box to keep characters in their final position.
  shown.forEach((line, i) => {
    if (!line) return;
    const fullW = widths[i];
    const lineLeft = pad + (s.align === 'left' ? 0 : s.align === 'right' ? textW - fullW : (textW - fullW) / 2);
    const y = pad + lineH * i + lineH / 2;
    g.textAlign = dir === 'rtl' ? 'right' : 'left';
    const x = dir === 'rtl' ? lineLeft + fullW : lineLeft;
    const withShadow = () => {
      if (s.shadowBlur > 0 || s.shadowOffsetX || s.shadowOffsetY) {
        g.shadowColor = s.shadowColor;
        g.shadowBlur = s.shadowBlur * scale;
        g.shadowOffsetX = s.shadowOffsetX * scale;
        g.shadowOffsetY = s.shadowOffsetY * scale;
      }
    };
    const noShadow = () => {
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetX = 0;
      g.shadowOffsetY = 0;
    };
    if (s.outlineWidth > 0) {
      withShadow();
      g.strokeStyle = s.outlineColor;
      g.lineWidth = s.outlineWidth * 2; // half the stroke is hidden under the fill
      g.strokeText(line, x, y);
      noShadow();
    } else {
      withShadow();
    }
    g.fillStyle = s.color;
    g.fillText(line, x, y);
    noShadow();
  });

  return { canvas, logicalWidth, logicalHeight };
}

function setSpacing(g: CanvasRenderingContext2D, px: number) {
  const ctx = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Drops cached bitmaps (e.g. when the project is closed). */
export function clearTextCache() {
  cache.clear();
}
