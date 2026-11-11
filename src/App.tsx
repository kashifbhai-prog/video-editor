import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAutosave, useUnsavedChangesGuard } from './hooks/useAutosave';
import { useResponsivePanels } from './hooks/useResponsivePanels';
import { useGlobalFileDrop } from './hooks/useGlobalFileDrop';
import { useSequenceSync } from './hooks/useSequenceSync';
import { restoreProject } from './services/projectService';

let restorePromise: Promise<boolean> | null = null;

export default function App() {
  const [ready, setReady] = useState(false);

  useKeyboardShortcuts();
  useAutosave();
  useUnsavedChangesGuard();
  useResponsivePanels();
  useGlobalFileDrop();
  useSequenceSync();

  useEffect(() => {
    // Guarded so StrictMode's double effect run restores only once.
    restorePromise ??= restoreProject().catch(() => false);
    restorePromise.finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-app text-[12px] text-fg-muted">
        <Loader2 size={16} className="animate-spin" />
        Loading project…
      </div>
    );
  }
  return <EditorLayout />;
}
