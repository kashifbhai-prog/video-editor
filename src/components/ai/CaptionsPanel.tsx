import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Loader2, Plus, Trash2, Upload, Wand2 } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { previewEngine } from '../../engine/previewEngine';
import { FONT_FAMILIES } from '../../engine/catalog';
import { clipEnd } from '../../engine/timelineModel';
import {
  CAPTION_LANGUAGES,
  CAPTION_MODELS,
  CAPTION_STYLE,
  captionClips,
  captionTracks,
  exportSrt,
  generateCaptions,
  importSrt,
  placeCaptions,
  setCaptionTiming,
  shiftAllCaptions,
  styleAllCaptions,
} from '../../services/ai/captions';
import { setAiSettings, useAiResults } from '../../services/ai/aiStore';
import { updateTextContent } from '../../services/advancedEditing';
import { openFilePicker } from '../../utils/filePicker';
import type { Clip } from '../../types';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { PanelHeader } from '../library/PanelChrome';
import { useSelectedClipIds } from '../library/PanelChrome';
import { ColorField, SecondsField, Segmented, SliderRow } from '../properties/controls';
import { PropertySection } from '../properties/PropertySection';
import { AiJobList, Check, Field, LocalBadge, fmtTime, useJobRunning } from './AiShared';

function CueRow({ clip, active }: { clip: Clip; active: boolean }) {
  const [text, setText] = useState(clip.text!.content);
  useEffect(() => setText(clip.text!.content), [clip.text]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div ref={ref} data-testid="caption-cue" className={`space-y-1 rounded-md border p-1.5 ${active ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2'}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => previewEngine.seek(clip.start)} className="font-mono text-[10px] text-fg-subtle hover:text-accent" title="Go to this caption">
          {fmtTime(clip.start)}
        </button>
        <div className="w-14">
          <SecondsField label="Caption start" value={clip.start} onCommit={(v) => setCaptionTiming(clip.id, v, clipEnd(clip))} />
        </div>
        <span className="text-[10px] text-fg-subtle">→</span>
        <div className="w-14">
          <SecondsField label="Caption end" value={clipEnd(clip)} onCommit={(v) => setCaptionTiming(clip.id, clip.start, v)} />
        </div>
        <button
          type="button"
          aria-label="Delete caption"
          onClick={() => useProjectStore.getState().deleteClips([clip.id])}
          className="ml-auto rounded p-1 text-fg-subtle hover:text-danger"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <textarea
        aria-label="Caption text"
        dir="auto"
        rows={Math.min(3, text.split('\n').length)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== clip.text!.content && updateTextContent(clip.id, text)}
        className="field block w-full resize-none py-1 text-[12px] leading-snug"
      />
    </div>
  );
}

export function CaptionsPanel() {
  const doc = useProjectStore((s) => s.document);
  const settings = useAiResults((s) => s.settings);
  const running = useJobRunning('captions');
  const selected = useSelectedClipIds();
  const [source, setSource] = useState<'timeline' | 'selection'>('timeline');
  const [replace, setReplace] = useState(true);
  const cues = useMemo(() => captionClips(doc), [doc]);
  const track = captionTracks(doc)[0];
  const activeId = usePlaybackStore((s) => cues.find((c) => s.timelineTime >= c.start && s.timelineTime < clipEnd(c))?.id ?? null);
  const first = cues[0];
  const style = first?.text?.style ?? CAPTION_STYLE;
  const y = first?.transform.y ?? 0.38;
  const model = CAPTION_MODELS.find((m) => m.value === settings.model)!;
  const selectedAudible = selected.filter((id) => doc.clips[id] && !doc.clips[id].text);

  const generate = () => void generateCaptions({ replace, clipIds: source === 'selection' ? selectedAudible : undefined });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="captions-panel">
      <PanelHeader title="Captions" count={cues.length || undefined} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <PropertySection title="Auto captions (AI)">
          <LocalBadge>
            Speech recognition (Whisper) runs on this device. The model is downloaded once ({settings.device === 'cpu' ? model.size.cpu : model.size.gpu} MB), then works offline. No API key, nothing is uploaded.
          </LocalBadge>
          <Field label="Audio">
            <Select
              ariaLabel="Caption audio source"
              value={source}
              onChange={setSource}
              options={[
                { value: 'timeline', label: 'Whole timeline' },
                { value: 'selection', label: `Selected clip${selectedAudible.length === 1 ? '' : 's'} only` },
              ]}
            />
          </Field>
          <Field label="Language">
            <Select ariaLabel="Caption language" value={settings.language} onChange={(language) => setAiSettings({ language })} options={CAPTION_LANGUAGES} />
          </Field>
          <Field label="Model">
            <Select ariaLabel="Speech model" value={settings.model} onChange={(m) => setAiSettings({ model: m })} options={CAPTION_MODELS.map((m) => ({ value: m.value, label: m.label }))} />
          </Field>
          <p className="text-[10px] leading-relaxed text-fg-subtle">{model.hint}</p>
          <Check checked={settings.device === 'auto'} onChange={(v) => setAiSettings({ device: v ? 'auto' : 'cpu' })}>
            Use the graphics card when available (faster for long videos; {model.size.gpu} MB download)
          </Check>
          <Check checked={replace} onChange={setReplace}>
            Replace existing captions
          </Check>
          <Button variant="primary" className="w-full" disabled={running || (source === 'selection' && !selectedAudible.length)} onClick={generate}>
            {running ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Generate captions
          </Button>
          <AiJobList kinds={['captions']} />
        </PropertySection>

        {cues.length > 0 && (
          <PropertySection title="Style (all captions)">
            <Check checked={!track?.hidden} onChange={() => track && useProjectStore.getState().toggleTrackFlag(track.id, 'hidden')}>
              <span className="inline-flex items-center gap-1">
                {track?.hidden ? <EyeOff size={11} /> : <Eye size={11} />} Show captions (preview and export)
              </span>
            </Check>
            <Field label="Font">
              <Select ariaLabel="Caption font" value={style.fontFamily} onChange={(fontFamily) => styleAllCaptions({ fontFamily })} options={FONT_FAMILIES} />
            </Field>
            <SliderRow label="Size" value={style.fontSize} min={24} max={120} step={1} format={(v) => `${v}px`} onChange={(fontSize) => styleAllCaptions({ fontSize }, undefined, 'captions.size')} />
            <ColorField label="Text colour" value={style.color} onChange={(color) => styleAllCaptions({ color }, undefined, 'captions.color')} />
            <Check checked={!!style.background} onChange={(on) => styleAllCaptions({ background: on ? 'rgba(0,0,0,0.55)' : null })}>
              Background box
            </Check>
            {style.background && <ColorField label="Box colour" withAlpha value={style.background} onChange={(background) => styleAllCaptions({ background }, undefined, 'captions.bg')} />}
            <SliderRow label="Outline" value={style.outlineWidth} min={0} max={10} step={0.5} format={(v) => `${v}px`} onChange={(outlineWidth) => styleAllCaptions({ outlineWidth }, undefined, 'captions.outline')} />
            <Segmented
              ariaLabel="Caption position"
              value={y < -0.15 ? 'top' : y > 0.15 ? 'bottom' : 'middle'}
              onChange={(p) => styleAllCaptions({}, p === 'top' ? -0.38 : p === 'bottom' ? 0.38 : 0)}
              options={[
                { value: 'top', label: 'Top', title: 'Captions at the top' },
                { value: 'middle', label: 'Middle', title: 'Captions in the middle' },
                { value: 'bottom', label: 'Bottom', title: 'Captions at the bottom' },
              ]}
            />
            <SliderRow label="Vertical position" value={y} min={-0.48} max={0.48} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => styleAllCaptions({}, v, 'captions.y')} />
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="flex-1">Sync (shift all)</span>
              <Button className="px-2!" onClick={() => shiftAllCaptions(-0.1)} title="Show all captions 0.1 s earlier">
                −0.1 s
              </Button>
              <Button className="px-2!" onClick={() => shiftAllCaptions(0.1)} title="Show all captions 0.1 s later">
                +0.1 s
              </Button>
            </div>
          </PropertySection>
        )}

        <PropertySection title={`Edit captions${cues.length ? ` (${cues.length})` : ''}`}>
          <div className="flex gap-1.5">
            <Button
              className="flex-1 px-1!"
              onClick={() => {
                const t = usePlaybackStore.getState().timelineTime;
                placeCaptions([{ start: t, end: t + 2, text: 'New caption' }], false);
              }}
            >
              <Plus size={12} /> Add
            </Button>
            <Button className="flex-1 px-1!" onClick={() => void openFilePicker('.srt', false).then((f) => f[0] && importSrt(f[0]))}>
              <Upload size={12} /> Import
            </Button>
            <Button className="flex-1 px-1!" disabled={!cues.length} onClick={exportSrt} title="Download the captions as an .srt subtitle file">
              <Download size={12} /> SRT
            </Button>
          </div>
          {!cues.length && <p className="text-[11px] leading-relaxed text-fg-subtle">Generate captions, import an .srt file, or add one at the playhead. Captions are text clips on the "Captions" track.</p>}
          <div className="space-y-1.5">
            {cues.map((c) => (
              <CueRow key={c.id} clip={c} active={c.id === activeId} />
            ))}
          </div>
        </PropertySection>
      </div>
    </div>
  );
}
