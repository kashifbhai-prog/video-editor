import { create } from 'zustand';
import type { Clip, EffectType, MediaItem, TransitionType } from '../../types';

// ---------------------------------------------------------------------------
// Transient timeline interaction state. Lives outside the project store so
// dragging never creates history entries – the edit is committed once on drop.
// ---------------------------------------------------------------------------

export type ClipPreview = Pick<Clip, 'start' | 'trackId' | 'sourceIn' | 'sourceOut'>;

export interface DropGhost {
  /** Track id, or 'new' for the "add track" drop zone. */
  trackId: string;
  start: number;
  duration: number;
  valid: boolean;
}

interface DragState {
  /** Live geometry of clips being moved / trimmed. */
  previews: Record<string, ClipPreview>;
  /** Snap guide position (seconds) while a snap is engaged. */
  snapAt: number | null;
  /** Library item being dragged over the timeline. */
  ghost: DropGhost | null;
}

export const useDragStore = create<DragState>()(() => ({ previews: {}, snapAt: null, ghost: null }));

export const clearDrag = () => useDragStore.setState({ previews: {}, snapAt: null, ghost: null });

/** MIME type used when dragging library items onto the timeline. */
export const MEDIA_DRAG_MIME = 'application/x-reelforge-media';

/**
 * Browsers hide dataTransfer contents during dragover, so the dragged media is
 * also tracked here for drop previews.
 */
let draggedMedia: MediaItem | null = null;
export const setDraggedMedia = (m: MediaItem | null) => {
  draggedMedia = m;
  if (!m) useDragStore.setState({ ghost: null });
};
export const getDraggedMedia = () => draggedMedia;

// ---- Phase 3: transitions / effects / filters dragged from their libraries ----

export const LIBRARY_DRAG_MIME = 'application/x-reelforge-library';

export type LibraryDragItem =
  | { kind: 'transition'; type: TransitionType }
  | { kind: 'effect'; type: EffectType }
  | { kind: 'filter'; presetId: string };

/** Drop target highlight while a library item is over the timeline. */
export interface LibraryDropHint {
  /** A cut between two clips (transitions). */
  cut?: { trackId: string; at: number; valid: boolean };
  /** A clip (effects / filters). */
  clipId?: string;
}

let draggedLibraryItem: LibraryDragItem | null = null;
export const useLibraryDropHint = create<{ hint: LibraryDropHint | null }>()(() => ({ hint: null }));
export const setDraggedLibraryItem = (item: LibraryDragItem | null) => {
  draggedLibraryItem = item;
  if (!item) useLibraryDropHint.setState({ hint: null });
};
export const getDraggedLibraryItem = () => draggedLibraryItem;
