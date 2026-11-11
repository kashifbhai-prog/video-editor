import { useEffect, useState } from 'react';
import { useExportStore } from '../../services/exportService';
import { Download, PanelRight, Redo2, Save, Settings, Undo2 } from 'lucide-react';
import { selectCanRedo, selectCanUndo, useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useMediaStore } from '../../store/mediaStore';
import { saveProject } from '../../services/projectService';
import { formatRelativeTime } from '../../utils/format';
import { IconButton } from '../controls/IconButton';
import { Tooltip } from '../controls/Tooltip';
import { ProjectNameEditor } from './ProjectNameEditor';
import { cn } from '../../utils/cn';
import logoUrl from '../../assets/logo.jpg';

function BrandMark() {
  // The logo is drawn on black: "screen" blending makes the black blend into the top bar.
  return (
    <div className="flex items-center pr-2">
      <img src={logoUrl} alt="Vyora" draggable={false} className="h-6 w-auto select-none mix-blend-screen" />
    </div>
  );
}

function SaveStatus() {
  const dirty = useProjectStore((s) => s.dirty);
  const savedAt = useProjectStore((s) => s.savedAt);
  const importing = useMediaStore((s) => s.importing);
  const [, tick] = useState(0);

  // Refresh relative time label.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  let label = 'Not saved yet';
  if (importing > 0) label = `Importing ${importing} file${importing === 1 ? '' : 's'}…`;
  else if (dirty) label = 'Unsaved changes';
  else if (savedAt) label = `Saved ${formatRelativeTime(savedAt)}`;

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          importing > 0 ? 'animate-pulse bg-accent' : dirty ? 'bg-warning' : savedAt ? 'bg-success' : 'bg-fg-subtle',
        )}
      />
      {label}
    </span>
  );
}

export function TopBar() {
  // Visible while an export runs in the background (dialog hidden).
  const exportProgress = useExportStore((st) => (st.status === 'running' ? (st.progress?.progress ?? 0) : null));
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const openDialog = useUiStore((s) => s.openDialog);
  const propertiesOpen = useUiStore((s) => s.propertiesOpen);
  const setPropertiesOpen = useUiStore((s) => s.setPropertiesOpen);

  return (
    <header className="relative flex h-11 shrink-0 items-center justify-between border-b border-line bg-panel px-3">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark />
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} />
        <IconButton icon={Redo2} label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo} />
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center">
        <ProjectNameEditor />
      </div>

      <div className="flex items-center gap-1.5">
        <div className="mr-2 hidden lg:block">
          <SaveStatus />
        </div>
        <IconButton icon={Save} label="Save project" shortcut="Ctrl+S" onClick={() => void saveProject()} />
        <IconButton icon={Settings} label="Settings" onClick={() => openDialog('settings')} />
        <IconButton
          icon={PanelRight}
          label={propertiesOpen ? 'Hide properties panel' : 'Show properties panel'}
          active={propertiesOpen}
          onClick={() => setPropertiesOpen(!propertiesOpen)}
        />
        <Tooltip label="Export" shortcut="Ctrl+E">
          <button
            type="button"
            onClick={() => openDialog('export')}
            className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <Download size={14} strokeWidth={2} />
            {exportProgress !== null ? 'Exporting ' + Math.floor(exportProgress * 100) + '%' : 'Export'}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
