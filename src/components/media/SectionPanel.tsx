import { Captions, type LucideIcon } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import type { SidebarSection } from '../../types';
import { MediaLibrary } from './MediaLibrary';
import { TextPanel } from '../library/TextPanel';
import { StickersPanel } from '../library/StickersPanel';
import { EffectsPanel } from '../library/EffectsPanel';
import { TransitionsPanel } from '../library/TransitionsPanel';
import { FiltersPanel } from '../library/FiltersPanel';
import { VoiceRecorder } from '../library/VoiceRecorder';

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.weba';

/** Sections whose tools are delivered in later phases. */
const UPCOMING: Partial<Record<SidebarSection, { title: string; icon: LucideIcon; phase: number; body: string }>> = {
  captions: {
    title: 'Captions',
    icon: Captions,
    phase: 5,
    body: 'Automatic speech-to-text captions will be generated onto the text track.',
  },
};

function UpcomingSection({ section }: { section: SidebarSection }) {
  const info = UPCOMING[section];
  if (!info) return null;
  const Icon = info.icon;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-[12px] font-semibold">{info.title}</h2>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel-3 text-fg-muted">
          <Icon size={20} />
        </span>
        <div className="text-[12px] font-medium text-fg">Arrives in Phase {info.phase}</div>
        <p className="max-w-[230px] text-[11px] leading-relaxed text-fg-subtle">{info.body}</p>
      </div>
    </div>
  );
}

/** Content panel next to the sidebar rail; switches on the active section. */
export function SectionPanel() {
  const section = useUiStore((s) => s.activeSection);

  return (
    <aside aria-label={`${section} panel`} className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-panel">
      {section === 'media' && <MediaLibrary />}
      {section === 'audio' && (
        <div className="flex h-full min-h-0 flex-col">
          <VoiceRecorder />
          <div className="min-h-0 flex-1">
            <MediaLibrary
              lockedKind="audio"
              title="Audio"
              accept={AUDIO_ACCEPT}
              emptyHint="Import music, voice-overs or sound effects (MP3, WAV, M4A, OGG, FLAC)."
            />
          </div>
        </div>
      )}
      {section === 'text' && <TextPanel />}
      {section === 'stickers' && <StickersPanel />}
      {section === 'effects' && <EffectsPanel />}
      {section === 'transitions' && <TransitionsPanel />}
      {section === 'filters' && <FiltersPanel />}
      {section === 'captions' && <UpcomingSection section={section} />}
    </aside>
  );
}
