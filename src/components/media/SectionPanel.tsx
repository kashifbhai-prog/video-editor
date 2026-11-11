import { useUiStore } from '../../store/uiStore';
import { MediaLibrary } from './MediaLibrary';
import { TextPanel } from '../library/TextPanel';
import { StickersPanel } from '../library/StickersPanel';
import { EffectsPanel } from '../library/EffectsPanel';
import { TransitionsPanel } from '../library/TransitionsPanel';
import { FiltersPanel } from '../library/FiltersPanel';
import { VoiceRecorder } from '../library/VoiceRecorder';
import { lazy, Suspense } from 'react';

// AI panels load on first open (keeps the editor's startup bundle small).
const CaptionsPanel = lazy(() => import('../ai/CaptionsPanel').then((m) => ({ default: m.CaptionsPanel })));
const AiToolsPanel = lazy(() => import('../ai/AiToolsPanel').then((m) => ({ default: m.AiToolsPanel })));
const PanelLoading = () => <div className="p-3 text-[11px] text-fg-subtle">Loading…</div>;

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.weba';

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
      {section === 'captions' && (
        <Suspense fallback={<PanelLoading />}>
          <CaptionsPanel />
        </Suspense>
      )}
      {section === 'ai' && (
        <Suspense fallback={<PanelLoading />}>
          <AiToolsPanel />
        </Suspense>
      )}
    </aside>
  );
}
