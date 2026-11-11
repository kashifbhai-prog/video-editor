import { useUiStore } from '../../store/uiStore';
import { TopBar } from '../navigation/TopBar';
import { LeftSidebar } from '../navigation/LeftSidebar';
import { SectionPanel } from '../media/SectionPanel';
import { PreviewPlayer } from '../preview/PreviewPlayer';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { Timeline } from '../timeline/Timeline';
import { TimelineResizeHandle } from './ResizeHandle';
import { Toaster } from '../controls/Toaster';
import { SettingsDialog } from './SettingsDialog';
import { FeedbackDialog } from './FeedbackDialog';
import { ExportDialog } from './ExportDialog';

export function EditorLayout() {
  const libraryOpen = useUiStore((s) => s.libraryOpen);
  const propertiesOpen = useUiStore((s) => s.propertiesOpen);
  const timelineHeight = useUiStore((s) => s.timelineHeight);
  const dialog = useUiStore((s) => s.dialog);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app text-fg">
      <TopBar />
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <LeftSidebar />
        {libraryOpen && <SectionPanel />}
        <PreviewPlayer />
        {propertiesOpen && <PropertiesPanel />}
      </main>
      <TimelineResizeHandle />
      <div className="shrink-0 overflow-hidden" style={{ height: timelineHeight }}>
        <Timeline />
      </div>

      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'feedback' && <FeedbackDialog />}
      <Toaster />
    </div>
  );
}
