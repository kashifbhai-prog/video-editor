import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { resetProject } from '../../services/projectService';
import { Dialog } from '../controls/Dialog';
import { Button } from '../controls/Button';

/** Confirmation before "New project" wipes the current project (top bar button and Settings). */
export function NewProjectDialog() {
  const close = () => useUiStore.getState().openDialog(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await resetProject();
    } finally {
      close();
    }
  };

  return (
    <Dialog
      title="Start a new project?"
      onClose={close}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy} autoFocus>
            No, keep my project
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy} data-testid="confirm-new-project">
            Yes, start a new project
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <TriangleAlert size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="space-y-2 text-[12px] leading-relaxed text-fg">
          <p>
            <strong>Your current project will be lost.</strong> Its timeline and all the media you imported will be
            permanently removed from this browser. This cannot be undone.
          </p>
          <p className="text-fg-muted">
            To keep your work, choose <em>No</em> and export your video (MP4) first.
          </p>
          <p>Do you want to start a new project?</p>
        </div>
      </div>
    </Dialog>
  );
}
