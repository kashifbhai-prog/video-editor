import { useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import { previewEngine } from '../engine/previewEngine';
import { buildSourceSequence, buildTimelineSequence, EMPTY_SEQUENCE } from '../engine/sequence';

/** Rebuilds the engine's sequence whenever the document, media or preview mode changes. */
export function rebuildSequence() {
  const doc = useProjectStore.getState().document;
  const media = useMediaStore.getState().items;
  const { previewMode, previewMediaId } = useUiStore.getState();
  if (previewMode === 'source' && previewMediaId) {
    const item = media.find((m) => m.id === previewMediaId);
    previewEngine.setSequence(item ? buildSourceSequence(item, doc.canvas.frameRate) : { ...EMPTY_SEQUENCE, key: `source:${previewMediaId}` });
    return;
  }
  previewEngine.setSequence(buildTimelineSequence(doc, new Map(media.map((m) => [m.id, m]))));
}

/**
 * Subscribes outside React so edits reach the engine synchronously (e.g. a
 * split followed by an immediate seek) and without re-rendering components.
 */
export function useSequenceSync() {
  useEffect(() => {
    rebuildSequence();
    const unsubs = [
      useProjectStore.subscribe((s, prev) => s.document !== prev.document && rebuildSequence()),
      useMediaStore.subscribe((s, prev) => s.items !== prev.items && rebuildSequence()),
      useUiStore.subscribe(
        (s, prev) => (s.previewMode !== prev.previewMode || s.previewMediaId !== prev.previewMediaId) && rebuildSequence(),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
}
