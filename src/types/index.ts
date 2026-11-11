// ---------------------------------------------------------------------------
// Domain types shared across the application.
// These are intentionally designed so that Phase 2+ (clips, effects, export)
// can extend them without breaking the Phase 1 data model.
// ---------------------------------------------------------------------------

export type MediaKind = 'video' | 'image' | 'audio';

export type MediaStatus = 'processing' | 'ready' | 'error';

/** A media asset imported by the user. `url` is a runtime object URL. */
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  size: number;
  /** Seconds. Undefined for still images. */
  duration?: number;
  width?: number;
  height?: number;
  /** Runtime-only object URL for the underlying Blob. Never persisted. */
  url: string;
  /** Small JPEG data URL (video/image) used for library thumbnails. */
  thumbnail?: string;
  /** Normalised (0..1) audio peaks used to draw waveforms. */
  waveform?: number[];
  status: MediaStatus;
  error?: string;
  /** Whether the blob was successfully written to IndexedDB. */
  persisted: boolean;
  importedAt: number;
}

/** Media metadata as stored on disk (no runtime URL / status). */
export type PersistedMediaMeta = Omit<MediaItem, 'url' | 'status' | 'error' | 'persisted'>;

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type ResolutionPreset = '720p' | '1080p' | '1440p' | '2160p';

export type FrameRate = 24 | 25 | 30 | 50 | 60;

export interface CanvasSettings {
  aspectRatio: AspectRatio;
  resolution: ResolutionPreset;
  backgroundColor: string;
  frameRate: FrameRate;
}

export type TrackType = 'video' | 'overlay' | 'text' | 'audio';

/**
 * Placement of a visual clip on the canvas.
 *  x / y: offset of the clip's anchor point from the canvas centre, as a fraction
 *         of canvas width / height (0 = centred, 0.5 = half a canvas to the right/down).
 *  scale: 1 = fitted to the canvas (see `Clip.fit`); text: 1 = its natural size.
 *  rotation: degrees, clockwise.
 *  anchorX / anchorY: the point of the clip (0..1 of its box) that sits at x/y
 *         and that rotation / scaling pivot around. 0.5 / 0.5 = centre.
 * Fields added in Phase 3 are optional so older documents stay valid.
 */
export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  anchorX?: number;
  anchorY?: number;
}

/** Fractions (0..1) of the clip's box removed from each side. */
export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** contain = whole frame visible ("fit"), cover = canvas filled, edges cropped ("fill"). */
export type FitMode = 'contain' | 'cover';

// ---- Keyframes ---------------------------------------------------------------

export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** Properties that can be animated with keyframes (registry: engine/animation.ts). */
export type AnimatableProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface Keyframe {
  id: string;
  /** Seconds from the clip's start on the timeline. */
  time: number;
  value: number;
  /** Easing of the segment that starts at this keyframe. */
  easing: EasingType;
}

export type KeyframeTracks = Partial<Record<AnimatableProperty, Keyframe[]>>;

// ---- Colour, filters, effects -----------------------------------------------

/** All values are offsets from neutral (0). Ranges: see engine/catalog.ts. */
export interface ColorAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  sharpness: number;
  fade: number;
  vignette: number;
}

export interface FilterSetting {
  presetId: string;
  /** 0..1 */
  intensity: number;
}

export type EffectType =
  | 'blur'
  | 'gaussianBlur'
  | 'glow'
  | 'vignette'
  | 'sharpen'
  | 'noise'
  | 'filmGrain'
  | 'pixelate'
  | 'glitch'
  | 'rgbSplit'
  | 'chromaticAberration'
  | 'motionBlur';

export interface ClipEffect {
  id: string;
  type: EffectType;
  /** 0..1 */
  intensity: number;
  enabled: boolean;
}

// ---- Transitions ---------------------------------------------------------------

export type TransitionType =
  | 'fade'
  | 'dissolve'
  | 'crossfade'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'slideLeft'
  | 'slideRight'
  | 'blur';

/**
 * A transition across the cut between two adjacent clips on one track. It is
 * centred on the cut: it starts duration/2 before the cut and ends duration/2
 * after it, using media beyond the clips' in/out points when available.
 */
export interface Transition {
  id: string;
  type: TransitionType;
  fromClipId: string;
  toClipId: string;
  /** Seconds. */
  duration: number;
}

// ---- Text & animation presets ----------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right';
export type TextDirection = 'auto' | 'ltr' | 'rtl';

export interface TextStyle {
  fontFamily: string;
  /** Pixels at a 1080-pixel-high canvas; scales with the project resolution. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  /** Box behind the text; null = none. */
  background: string | null;
  align: TextAlign;
  direction: TextDirection;
  /** Pixels (at 1080p). */
  letterSpacing: number;
  /** Multiple of the font size. */
  lineHeight: number;
  outlineColor: string;
  /** Pixels (at 1080p); 0 = no outline. */
  outlineWidth: number;
  shadowColor: string;
  /** Pixels (at 1080p); 0 = no shadow. */
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface TextData {
  content: string;
  style: TextStyle;
}

export type InAnimationType = 'none' | 'fadeIn' | 'slideIn' | 'zoomIn' | 'typewriter' | 'popUp';
export type OutAnimationType = 'none' | 'fadeOut' | 'slideOut' | 'zoomOut';

/** Entrance / exit presets (text, stickers and other visual clips). */
export interface ClipAnimation {
  in: { type: InAnimationType; duration: number };
  out: { type: OutAnimationType; duration: number };
}

/**
 * A timeline instance of a media item. Source media lives in the media library;
 * many clips may reference the same `mediaId`.
 *
 * Timeline duration is derived: (sourceOut - sourceIn) / speed — see
 * `clipDuration` in engine/timelineModel.ts. For still images the source range
 * is simply the display length.
 */
export interface Clip {
  id: string;
  mediaId: string;
  trackId: string;
  name: string;
  /** Timeline position of the clip's first frame, in seconds. */
  start: number;
  /** In-point inside the source media, in seconds. */
  sourceIn: number;
  /** Out-point inside the source media, in seconds (exclusive). */
  sourceOut: number;
  /** Playback rate; 1 = normal speed. */
  speed: number;
  /** 0..1 – applies to clips with audio. */
  volume: number;
  /** 0..1 – applies to visual clips. */
  opacity: number;
  transform: ClipTransform;

  // ---- Phase 3 (all optional: absent = neutral) ----
  /** Play the source range backwards. */
  reversed?: boolean;
  fit?: FitMode;
  crop?: CropRect;
  keyframes?: KeyframeTracks;
  color?: ColorAdjustments;
  filter?: FilterSetting | null;
  effects?: ClipEffect[];
  animation?: ClipAnimation;
  /** Audio processing (Phase 4; absent = neutral). */
  audio?: ClipAudio;
  /** AI background removal (Phase 5; absent = off). */
  matte?: ClipMatte;
  /** Present on text clips (which have no media: `mediaId` is ''). */
  text?: TextData;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  /** The main video track cannot be removed. */
  isMain: boolean;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  /** Track volume (0..2, default 1). Applies to every clip with audio on the track. */
  volume?: number;
  /** Text track holding generated / imported subtitles (Phase 5). */
  captions?: boolean;
}

/** The undoable, serialisable part of a project. */
export interface ProjectDocument {
  name: string;
  canvas: CanvasSettings;
  /** Top-to-bottom display order; tracks higher in the list render on top. */
  tracks: Track[];
  /** All timeline clips keyed by id (flat, so moving between tracks is cheap). */
  clips: Record<string, Clip>;
  /** Transitions keyed by id (Phase 3; absent in older documents). */
  transitions?: Record<string, Transition>;
}

export interface SavedProject {
  version: 1;
  id: string;
  createdAt: number;
  savedAt: number;
  document: ProjectDocument;
  mediaIds: string[];
  /** Last used export settings (Phase 4). */
  exportSettings?: ExportSettings;
}

// ---- Audio (Phase 4) --------------------------------------------------------------

/** Per-clip audio processing. All values neutral at 0 (except eq bands, also 0 dB). */
/** What replaces the removed background of a person (Phase 5). */
export type MatteMode = 'transparent' | 'color' | 'blur';

/** AI background removal settings of a video / image clip. */
export interface ClipMatte {
  enabled: boolean;
  mode: MatteMode;
  /** Replacement colour (mode 'color'). */
  color: string;
  /** 'fast': selfie segmenter (≈0.25 MB). 'quality': multi-class selfie model (≈16 MB, better hair / edges). */
  model: 'fast' | 'quality';
  /** 0..1 – how confident the model must be that a pixel is the person. */
  threshold: number;
  /** 0..1 – edge softness. */
  feather: number;
  /** 0..1 – background blur strength (mode 'blur'). */
  blur: number;
}

export interface ClipAudio {
  /** Clip gain in dB (-24..+24); "Normalize" sets this from the measured peak. */
  gainDb: number;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
  /** Low shelf @ 100 Hz, dB (-15..+15). */
  bass: number;
  /** High shelf @ 8 kHz, dB (-15..+15). */
  treble: number;
  /** 5-band peaking EQ (60, 250, 1k, 4k, 12k Hz), dB (-12..+12). */
  eq: [number, number, number, number, number];
  /** Stereo balance -1 (left) .. +1 (right). */
  pan: number;
  /** Noise reduction amount 0..1 (rumble filter + noise gate). */
  noiseReduction: number;
}

// ---- Export (Phase 4) -------------------------------------------------------------

export type ExportResolution = '480p' | '720p' | '1080p' | '1440p' | '2160p';
export type ExportPreset = 'draft' | 'standard' | 'high' | 'custom';
export type ExportVideoCodec = 'avc' | 'hevc';

export interface ExportSettings {
  preset: ExportPreset;
  resolution: ExportResolution;
  frameRate: FrameRate;
  videoCodec: ExportVideoCodec;
  /** Bits per second. */
  videoBitrate: number;
  audioBitrate: number;
  /** Without extension. */
  fileName: string;
}

export type SidebarSection =
  | 'media'
  | 'audio'
  | 'text'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'captions'
  | 'ai';

export type PreviewQuality = 'full' | 'half' | 'quarter';

export type MediaFilter = 'all' | MediaKind;

export type MediaViewMode = 'grid' | 'list';

export type Selection =
  | { kind: 'none' }
  | { kind: 'track'; id: string }
  | { kind: 'media'; id: string }
  | { kind: 'clips'; ids: string[] }
  | { kind: 'transition'; id: string };

/** What the preview shows: the edited timeline, or a single library item. */
export type PreviewMode = 'timeline' | 'source';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

export type AutosaveInterval = 0 | 60 | 300;
