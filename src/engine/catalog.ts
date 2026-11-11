import type {
  ColorAdjustments,
  EffectType,
  InAnimationType,
  OutAnimationType,
  TextStyle,
  TransitionType,
} from '../types';

// ---------------------------------------------------------------------------
// Static catalogs: colour adjustments, filter presets, effects, transitions,
// text defaults and animation presets. All presets are original to this app.
// ---------------------------------------------------------------------------

// ---- Colour adjustments ---------------------------------------------------------

export type ColorKey = keyof ColorAdjustments;

export const NEUTRAL_COLOR: ColorAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpness: 0,
  fade: 0,
  vignette: 0,
};

export const COLOR_ADJUSTMENTS: { key: ColorKey; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1 },
  { key: 'exposure', label: 'Exposure', min: -1, max: 1 },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1 },
  { key: 'tint', label: 'Tint', min: -1, max: 1 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1 },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1 },
  { key: 'fade', label: 'Fade', min: 0, max: 1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1 },
];

export const isNeutralColor = (c: ColorAdjustments | undefined) =>
  !c || COLOR_ADJUSTMENTS.every(({ key }) => Math.abs(c[key]) < 1e-4);

// ---- Filter presets -----------------------------------------------------------------

/**
 * A filter is a colour grade: adjustment offsets plus optional split toning
 * (RGB tints pushed into shadows / highlights). Intensity scales all of it.
 */
export interface FilterPreset {
  id: string;
  name: string;
  category: 'Warm' | 'Cool' | 'Mono' | 'Film' | 'Vivid';
  adjust: Partial<ColorAdjustments>;
  /** Split toning: colours added to shadows / highlights (RGB, -1..1). */
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
  /** CSS gradient used for the library swatch. */
  swatch: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    category: 'Warm',
    adjust: { temperature: 0.45, saturation: 0.12, contrast: 0.08, highlights: -0.1 },
    highlightTint: [0.08, 0.04, -0.04],
    swatch: 'linear-gradient(135deg,#f6b24a,#c8553d)',
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    category: 'Warm',
    adjust: { temperature: 0.3, tint: 0.12, saturation: -0.1, fade: 0.12, contrast: 0.1 },
    shadowTint: [0.06, 0.01, -0.03],
    swatch: 'linear-gradient(135deg,#d98b5f,#7a3b2e)',
  },
  {
    id: 'arctic',
    name: 'Arctic',
    category: 'Cool',
    adjust: { temperature: -0.45, saturation: -0.1, exposure: 0.08, contrast: 0.05 },
    shadowTint: [-0.03, 0.01, 0.06],
    swatch: 'linear-gradient(135deg,#bfe3ff,#3a6ea5)',
  },
  {
    id: 'harbor',
    name: 'Harbor',
    category: 'Cool',
    adjust: { contrast: 0.18, saturation: 0.05 },
    shadowTint: [-0.05, 0.03, 0.07],
    highlightTint: [0.07, 0.03, -0.04],
    swatch: 'linear-gradient(135deg,#1f6f78,#f0a35e)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    category: 'Mono',
    adjust: { saturation: -1, contrast: 0.2 },
    swatch: 'linear-gradient(135deg,#e5e5e5,#2b2b2b)',
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    category: 'Mono',
    adjust: { saturation: -1, contrast: 0.45, shadows: -0.25, vignette: 0.45 },
    swatch: 'linear-gradient(135deg,#9a9a9a,#050505)',
  },
  {
    id: 'sepia-press',
    name: 'Sepia Press',
    category: 'Mono',
    adjust: { saturation: -0.85, fade: 0.1, temperature: 0.25 },
    highlightTint: [0.1, 0.05, -0.04],
    shadowTint: [0.04, 0.01, -0.03],
    swatch: 'linear-gradient(135deg,#e8d3a9,#5b4127)',
  },
  {
    id: 'faded-reel',
    name: 'Faded Reel',
    category: 'Film',
    adjust: { fade: 0.35, saturation: -0.25, contrast: -0.1, temperature: 0.12, vignette: 0.25 },
    shadowTint: [0.02, 0.03, 0.05],
    swatch: 'linear-gradient(135deg,#c9b99a,#6f7a7c)',
  },
  {
    id: 'pastel-day',
    name: 'Pastel Day',
    category: 'Film',
    adjust: { exposure: 0.15, fade: 0.2, saturation: -0.15, contrast: -0.15 },
    highlightTint: [0.03, 0.0, 0.05],
    swatch: 'linear-gradient(135deg,#ffd6e0,#b8d8f2)',
  },
  {
    id: 'pop-max',
    name: 'Pop Max',
    category: 'Vivid',
    adjust: { saturation: 0.55, contrast: 0.2, sharpness: 0.25 },
    swatch: 'linear-gradient(135deg,#ff3d7f,#3dd6ff)',
  },
  {
    id: 'lush',
    name: 'Lush',
    category: 'Vivid',
    adjust: { saturation: 0.3, tint: -0.15, shadows: 0.12, contrast: 0.1 },
    swatch: 'linear-gradient(135deg,#9be15d,#00a37a)',
  },
];

export const filterPresetById = (id: string | undefined) => FILTER_PRESETS.find((f) => f.id === id);

// ---- Effects --------------------------------------------------------------------------

export interface EffectDef {
  type: EffectType;
  name: string;
  category: 'Blur' | 'Light' | 'Texture' | 'Distort';
  description: string;
  defaultIntensity: number;
}

export const EFFECTS: EffectDef[] = [
  { type: 'blur', name: 'Blur', category: 'Blur', description: 'Fast box blur', defaultIntensity: 0.4 },
  { type: 'gaussianBlur', name: 'Gaussian Blur', category: 'Blur', description: 'Smooth, high-quality blur', defaultIntensity: 0.4 },
  {
    type: 'motionBlur',
    name: 'Motion Blur',
    category: 'Blur',
    description: "Streaks along the clip's keyframed motion (horizontal when the clip is static)",
    defaultIntensity: 0.5,
  },
  { type: 'glow', name: 'Glow', category: 'Light', description: 'Bright areas bloom outward', defaultIntensity: 0.5 },
  { type: 'vignette', name: 'Vignette', category: 'Light', description: 'Darkens the edges', defaultIntensity: 0.5 },
  { type: 'sharpen', name: 'Sharpen', category: 'Texture', description: 'Crisper edges', defaultIntensity: 0.5 },
  { type: 'noise', name: 'Noise', category: 'Texture', description: 'Animated colour noise', defaultIntensity: 0.35 },
  { type: 'filmGrain', name: 'Film Grain', category: 'Texture', description: 'Fine luminance grain', defaultIntensity: 0.4 },
  { type: 'pixelate', name: 'Pixelate', category: 'Distort', description: 'Mosaic blocks', defaultIntensity: 0.4 },
  { type: 'glitch', name: 'Glitch', category: 'Distort', description: 'Animated slice displacement', defaultIntensity: 0.5 },
  { type: 'rgbSplit', name: 'RGB Split', category: 'Distort', description: 'Offsets the red and blue channels', defaultIntensity: 0.4 },
  {
    type: 'chromaticAberration',
    name: 'Chromatic Aberration',
    category: 'Distort',
    description: 'Lens-like colour fringing towards the edges',
    defaultIntensity: 0.5,
  },
];

export const effectDef = (type: EffectType) => EFFECTS.find((e) => e.type === type)!;

// ---- Transitions ----------------------------------------------------------------------

export interface TransitionDef {
  type: TransitionType;
  name: string;
  category: 'Basic' | 'Wipe' | 'Motion' | 'Blur';
}

export const TRANSITIONS: TransitionDef[] = [
  { type: 'fade', name: 'Fade', category: 'Basic' },
  { type: 'dissolve', name: 'Dissolve', category: 'Basic' },
  { type: 'crossfade', name: 'Crossfade', category: 'Basic' },
  { type: 'wipeLeft', name: 'Wipe Left', category: 'Wipe' },
  { type: 'wipeRight', name: 'Wipe Right', category: 'Wipe' },
  { type: 'wipeUp', name: 'Wipe Up', category: 'Wipe' },
  { type: 'wipeDown', name: 'Wipe Down', category: 'Wipe' },
  { type: 'zoomIn', name: 'Zoom In', category: 'Motion' },
  { type: 'zoomOut', name: 'Zoom Out', category: 'Motion' },
  { type: 'slideLeft', name: 'Slide Left', category: 'Motion' },
  { type: 'slideRight', name: 'Slide Right', category: 'Motion' },
  { type: 'blur', name: 'Blur', category: 'Blur' },
];

export const transitionDef = (type: TransitionType) => TRANSITIONS.find((t) => t.type === type)!;
export const DEFAULT_TRANSITION_DURATION = 0.8;
export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 3;

// ---- Text -----------------------------------------------------------------------------

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Noto Naskh Arabic', label: 'Noto Naskh Arabic (Arabic)' },
  { value: 'Noto Nastaliq Urdu', label: 'Noto Nastaliq Urdu (Urdu)' },
];

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 96,
  fontWeight: 700,
  italic: false,
  color: '#ffffff',
  background: null,
  align: 'center',
  direction: 'auto',
  letterSpacing: 0,
  lineHeight: 1.2,
  outlineColor: '#000000',
  outlineWidth: 0,
  shadowColor: 'rgba(0,0,0,0.6)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

export interface TextPreset {
  id: string;
  name: string;
  content: string;
  style: Partial<TextStyle>;
  y?: number;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'title', name: 'Title', content: 'Your title', style: { fontSize: 120, fontWeight: 800 } },
  { id: 'subtitle', name: 'Subtitle', content: 'Subtitle text', style: { fontSize: 56, fontWeight: 500 }, y: 0.36 },
  {
    id: 'outline',
    name: 'Outline',
    content: 'OUTLINE',
    style: { fontSize: 128, fontWeight: 900, color: '#ffffff', outlineColor: '#111111', outlineWidth: 8, letterSpacing: 6 },
  },
  {
    id: 'shadow',
    name: 'Drop shadow',
    content: 'Shadow',
    style: { fontSize: 110, fontWeight: 800, shadowBlur: 18, shadowOffsetY: 8, shadowColor: 'rgba(0,0,0,0.85)' },
  },
  {
    id: 'label',
    name: 'Label box',
    content: 'Label',
    style: { fontSize: 64, fontWeight: 600, color: '#111111', background: '#ffd43b' },
    y: 0.3,
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    content: 'Name Surname\nRole or location',
    style: { fontSize: 52, fontWeight: 600, align: 'left', background: 'rgba(12,14,20,0.75)', lineHeight: 1.35 },
    y: 0.32,
  },
  {
    id: 'arabic',
    name: 'Arabic',
    content: 'مرحبا بكم',
    style: { fontFamily: 'Noto Naskh Arabic', fontSize: 110, fontWeight: 700, direction: 'rtl' },
  },
  {
    id: 'urdu',
    name: 'Urdu',
    content: 'خوش آمدید',
    style: { fontFamily: 'Noto Nastaliq Urdu', fontSize: 96, fontWeight: 700, direction: 'rtl', lineHeight: 1.9 },
  },
];

export const DEFAULT_TEXT_DURATION = 5;

// ---- Entrance / exit animations ---------------------------------------------------

export const IN_ANIMATIONS: { value: InAnimationType; label: string; textOnly?: boolean }[] = [
  { value: 'none', label: 'None' },
  { value: 'fadeIn', label: 'Fade in' },
  { value: 'slideIn', label: 'Slide in' },
  { value: 'zoomIn', label: 'Zoom in' },
  { value: 'popUp', label: 'Pop up' },
  { value: 'typewriter', label: 'Typewriter', textOnly: true },
];

export const OUT_ANIMATIONS: { value: OutAnimationType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fadeOut', label: 'Fade out' },
  { value: 'slideOut', label: 'Slide out' },
  { value: 'zoomOut', label: 'Zoom out' },
];

export const DEFAULT_ANIMATION_DURATION = 0.6;
