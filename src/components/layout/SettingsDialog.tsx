import { useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { resetProject } from '../../services/projectService';
import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';
import type { AutosaveInterval } from '../../types';
import { Dialog } from '../controls/Dialog';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';

const AUTOSAVE_OPTIONS: { value: AutosaveInterval; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
];

export function SettingsDialog() {
  const close = () => useUiStore.getState().openDialog(null);
  const autosave = useUiStore((s) => s.autosaveInterval);
  const setAutosave = useUiStore((s) => s.setAutosaveInterval);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Dialog title="Settings" onClose={close} width={520} footer={<Button onClick={close}>Close</Button>}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">General</h3>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[12px]">Autosave</div>
              <div className="text-[11px] text-fg-subtle">Saves project metadata and media references in this browser.</div>
            </div>
            <Select ariaLabel="Autosave interval" value={autosave} options={AUTOSAVE_OPTIONS} onChange={setAutosave} className="w-40" />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Keyboard shortcuts</h3>
          <div className="divide-y divide-line rounded-md border border-line">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                <span className="text-fg-muted">{s.action}</span>
                <kbd className="rounded border border-line-strong bg-panel-2 px-1.5 py-px font-mono text-[10px] text-fg">{s.keys}</kbd>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle">Ctrl + mouse wheel over the timeline also zooms.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-danger">Danger zone</h3>
          <div className="flex items-center justify-between gap-4 rounded-md border border-danger/30 p-3">
            <div>
              <div className="text-[12px]">New project</div>
              <div className="text-[11px] text-fg-subtle">Clears the current project, its saved copy and stored media.</div>
            </div>
            {confirmReset ? (
              <div className="flex gap-1.5">
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await resetProject();
                    close();
                  }}
                >
                  Confirm
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmReset(true)}>New project</Button>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
