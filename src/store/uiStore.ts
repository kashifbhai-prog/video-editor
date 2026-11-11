import { create } from 'zustand';
import type {
  AutosaveInterval,
  Clip,
  PreviewMode,
  MediaFilter,
  MediaViewMode,
  PreviewQuality,
  Selection,
  SidebarSection,
  Toast,
  ToastTone,
} from '../types';
import { createId } from '../utils/id';
import { prefsStorage } from '../utils/storage';

// ---------------------------------------------------------------------------
// UI store: purely presentational state (panels, selection, zoom, dialogs).
// Not part of undo history.
// ---------------------------------------------------------------------------

export const TIMELINE_MIN_HEIGHT = 160;
export const TIMELINE_MAX_RATIO = 0.55;
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
/** Pixels per second at zoom 1. */
export const BASE_PX_PER_SECOND = 40;

const prefs = prefsStorage.load();

export type DialogName = 'settings' | 'export' | 'feedback' | null;

interface UiState {
  activeSection: SidebarSection;
  libraryOpen: boolean;
  propertiesOpen: boolean;
  selection: Selection;
  /** Library item shown in "source" preview mode. */
  previewMediaId: string | null;
  previewMode: PreviewMode;
  snapping: boolean;
  /** Copied clips (Ctrl+C) – plain data, never media binaries. */
  clipboard: Clip[];
  /** Bumped by "Show Properties": the inspector switches to the selected item. */
  propertiesFocus: number;

  mediaFilter: MediaFilter;
  mediaSearch: string;
  mediaViewMode: MediaViewMode;

  timelineZoom: number;
  timelineHeight: number;
  previewQuality: PreviewQuality;

  dialog: DialogName;
  autosaveInterval: AutosaveInterval;
  toasts: Toast[];

  selectSection: (section: SidebarSection) => void;
  setLibraryOpen: (open: boolean) => void;
  setPropertiesOpen: (open: boolean) => void;
  /** Opens the properties panel on the selected item. */
  focusProperties: () => void;
  setSelection: (selection: Selection) => void;
  /** Shows a library item in the preview (switches to source mode). */
  setPreviewMedia: (id: string | null) => void;
  /** Switches the preview back to the edited timeline. */
  showTimeline: () => void;
  setSnapping: (on: boolean) => void;
  setClipboard: (clips: Clip[]) => void;

  setMediaFilter: (f: MediaFilter) => void;
  setMediaSearch: (q: string) => void;
  setMediaViewMode: (m: MediaViewMode) => void;

  setTimelineZoom: (z: number) => void;
  zoomTimeline: (direction: 1 | -1) => void;
  setTimelineHeight: (h: number) => void;
  setPreviewQuality: (q: PreviewQuality) => void;

  openDialog: (d: DialogName) => void;
  setAutosaveInterval: (i: AutosaveInterval) => void;

  notify: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  activeSection: 'media',
  libraryOpen: true,
  propertiesOpen: true,
  selection: { kind: 'none' },
  previewMediaId: null,
  previewMode: 'timeline',
  snapping: true,
  clipboard: [],
  propertiesFocus: 0,

  mediaFilter: 'all',
  mediaSearch: '',
  mediaViewMode: prefs.mediaViewMode ?? 'grid',

  timelineZoom: 1,
  timelineHeight: prefs.timelineHeight ?? 280,
  previewQuality: 'full',

  dialog: null,
  autosaveInterval: prefs.autosaveInterval ?? 0,
  toasts: [],

  selectSection: (section) => {
    const { activeSection, libraryOpen } = get();
    // Clicking the active section toggles the panel, like desktop editors.
    if (section === activeSection) set({ libraryOpen: !libraryOpen });
    else set({ activeSection: section, libraryOpen: true });
  },
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setPropertiesOpen: (propertiesOpen) => set({ propertiesOpen }),
  focusProperties: () => set((s) => ({ propertiesOpen: true, propertiesFocus: s.propertiesFocus + 1 })),
  setSelection: (selection) =>
    set({ selection: selection.kind === 'clips' && selection.ids.length === 0 ? { kind: 'none' } : selection }),
  setPreviewMedia: (previewMediaId) =>
    set({ previewMediaId, previewMode: previewMediaId ? 'source' : 'timeline' }),
  showTimeline: () => {
    if (get().previewMode !== 'timeline') set({ previewMode: 'timeline' });
  },
  setSnapping: (snapping) => set({ snapping }),
  setClipboard: (clipboard) => set({ clipboard }),

  setMediaFilter: (mediaFilter) => set({ mediaFilter }),
  setMediaSearch: (mediaSearch) => set({ mediaSearch }),
  setMediaViewMode: (mediaViewMode) => {
    prefsStorage.save({ mediaViewMode });
    set({ mediaViewMode });
  },

  setTimelineZoom: (z) =>
    set({ timelineZoom: Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(ZOOM_LEVELS[0], z)) }),
  zoomTimeline: (direction) => {
    const z = get().timelineZoom;
    const next =
      direction > 0
        ? ZOOM_LEVELS.find((l) => l > z + 1e-6)
        : [...ZOOM_LEVELS].reverse().find((l) => l < z - 1e-6);
    if (next !== undefined) set({ timelineZoom: next });
  },
  setTimelineHeight: (h) => {
    const max = Math.max(TIMELINE_MIN_HEIGHT, window.innerHeight * TIMELINE_MAX_RATIO);
    const timelineHeight = Math.round(Math.min(max, Math.max(TIMELINE_MIN_HEIGHT, h)));
    set({ timelineHeight });
  },
  setPreviewQuality: (previewQuality) => set({ previewQuality }),

  openDialog: (dialog) => set({ dialog }),
  setAutosaveInterval: (autosaveInterval) => {
    prefsStorage.save({ autosaveInterval });
    set({ autosaveInterval });
  },

  notify: (message, tone = 'info') => {
    const id = createId('toast');
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, tone, message }] }));
    window.setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const pxPerSecond = (zoom: number) => BASE_PX_PER_SECOND * zoom;
