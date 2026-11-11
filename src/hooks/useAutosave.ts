import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { useProjectStore } from '../store/projectStore';
import { saveProject } from '../services/projectService';

/** Periodically saves the project when autosave is enabled and there are unsaved changes. */
export function useAutosave() {
  const interval = useUiStore((s) => s.autosaveInterval);
  useEffect(() => {
    if (!interval) return;
    const id = window.setInterval(() => {
      if (useProjectStore.getState().dirty) void saveProject({ silent: true });
    }, interval * 1000);
    return () => window.clearInterval(id);
  }, [interval]);
}

/** Warns before leaving the page with unsaved changes. */
export function useUnsavedChangesGuard() {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useProjectStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}
