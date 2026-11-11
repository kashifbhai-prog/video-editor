import { useEffect } from 'react';
import { useMediaStore } from '../store/mediaStore';

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * Prevents the browser's default "open dropped file in this tab" behaviour,
 * which would discard the whole editing session. Files dropped outside a
 * dedicated drop target are imported into the media library instead.
 * Dedicated targets call preventDefault first, so they are not imported twice.
 */
export function useGlobalFileDrop() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (!handled && e.dataTransfer?.files.length) {
        void useMediaStore.getState().importFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
