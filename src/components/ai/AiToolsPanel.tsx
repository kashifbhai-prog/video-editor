import { useMemo, useState } from 'react';
import { Check as CheckIcon, Headphones, Loader2, Scissors, SlidersVertical, Sparkles, Square, Volume2, Wand2, X } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { previewEngine } from '../../engine/previewEngine';
import { useAiResults, useIsFresh, type Suggestion } from '../../services/ai/aiStore';
import { DEFAULT_SILENCE, detectTimelineSilence, removeSelectedSilences, selectAllSilences, toggleSilence, updateSilenceOptions } from '../../services/ai/silence';
import { balanceVolumes, DEFAULT_ENHANCE, enhanceClip, playEnhancePreview, stopEnhancePreview, useEnhancePreview, type EnhanceOptions, type VoicePreset } from '../../services/ai/enhance';
import { acceptAllSuggestions, acceptSuggestion, analyzeClip, rejectSuggestion } from '../../services/ai/smartEdit';
import { insertHighlights, summarizeTimeline, toggleHighlight } from '../../services/ai/summary';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { PanelHeader, useSelectedClipIds } from '../library/PanelChrome';
import { SliderRow } from '../properties/controls';
import { PropertySection } from '../properties/PropertySection';
import { cn } from '../../utils/cn';
import { AiJobList, Check, Field, LocalBadge, fmtTime, useJobRunning } from './AiShared';
import { BackgroundControls } from './BackgroundSection';

function useSelectedClip() {
  const ids = useSelectedClipIds();
  const clips = useProjectStore((s) => s.document.clips);
  const tracks = useProjectStore((s) => s.document.tracks);
  const media = useMediaStore((s) => s.items);
  const clip = ids.length === 1 ? clips[ids[0]] : undefined;
  return {
    clip,
    media: clip ? media.find((m) => m.id === clip.mediaId) : undefined,
    locked: !!clip && !!tracks.find((t) => t.id === clip.trackId)?.locked,
  };
}

const Stale = () => <p className="rounded bg-warning/10 px-2 py-1 text-[10px] text-warning">The timeline changed after this analysis. Run it again to update.</p>;

// ---- Silence -----------------------------------------------------------------------------

function SilenceSection() {
  const res = useAiResults((s) => s.silence);
  const fresh = useIsFresh(res);
  const running = useJobRunning('silence');
  const [opts, setOpts] = useState(DEFAULT_SILENCE);
  const update = (patch: Partial<typeof opts>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    updateSilenceOptions(next);
  };
  const selected = res?.ranges.filter((r) => r.selected) ?? [];
  const total = selected.reduce((s, r) => s + r.end - r.start, 0);
  return (
    <PropertySection title="Silence removal">
      <p className="text-[11px] leading-relaxed text-fg-subtle">Finds pauses in the timeline's audio and removes them from every track at once (video and audio stay in sync).</p>
      <Check checked={opts.threshold === 'auto'} onChange={(auto) => update({ threshold: auto ? 'auto' : Math.round(res?.threshold ?? -45) })}>
        Automatic level{res ? ` (${res.threshold.toFixed(0)} dB)` : ''}
      </Check>
      {opts.threshold !== 'auto' && <SliderRow label="Silence below" value={opts.threshold} min={-70} max={-15} step={1} format={(v) => `${v} dB`} onChange={(threshold) => update({ threshold })} />}
      <SliderRow label="Shortest pause" value={opts.minDuration} min={0.2} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(minDuration) => update({ minDuration })} />
      <SliderRow label="Keep around speech" value={opts.padding} min={0} max={0.5} step={0.01} format={(v) => `${v.toFixed(2)} s`} onChange={(padding) => update({ padding })} />
      <Button className="w-full" disabled={running} onClick={() => void detectTimelineSilence(opts)}>
        {running ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />} Detect silence
      </Button>
      <AiJobList kinds={['silence']} />
      {res && (
        <div className="space-y-1.5" data-testid="silence-results">
          {!fresh && <Stale />}
          <div className="flex items-center justify-between text-[11px] text-fg-muted">
            <span>
              {res.ranges.length} pauses · {selected.length} selected ({total.toFixed(1)} s)
            </span>
            <span className="flex gap-1">
              <button type="button" className="hover:text-fg" onClick={() => selectAllSilences(true)}>All</button>·
              <button type="button" className="hover:text-fg" onClick={() => selectAllSilences(false)}>None</button>
            </span>
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {res.ranges.map((r, i) => (
              <label key={i} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-hover">
                <input type="checkbox" checked={r.selected} onChange={() => toggleSilence(i)} />
                <button type="button" className="font-mono text-fg-muted hover:text-accent" onClick={() => previewEngine.seek(r.start)}>
                  {fmtTime(r.start)} – {fmtTime(r.end)}
                </button>
                <span className="ml-auto font-mono text-fg-subtle">{(r.end - r.start).toFixed(2)} s</span>
              </label>
            ))}
          </div>
          <Button variant="primary" className="w-full" disabled={!fresh || !selected.length} onClick={removeSelectedSilences}>
            <Scissors size={13} /> Remove {selected.length} pause{selected.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </PropertySection>
  );
}

// ---- Audio enhancement ---------------------------------------------------------------------

function EnhanceSection() {
  const { clip, media, locked } = useSelectedClip();
  const running = useJobRunning('enhance');
  const preview = useEnhancePreview();
  const [opts, setOpts] = useState<EnhanceOptions>(DEFAULT_ENHANCE);
  const ok = !!clip && !!media && (media.kind === 'audio' || media.kind === 'video') && !locked;
  const set = (p: Partial<EnhanceOptions>) => {
    stopEnhancePreview();
    setOpts({ ...opts, ...p });
  };
  const play = (which: 'original' | 'enhanced') => (preview.playing === which ? stopEnhancePreview() : void playEnhancePreview(clip!.id, opts, which));
  return (
    <PropertySection title="Audio enhancement">
      {!ok && <p className="text-[11px] text-fg-subtle">Select one video or audio clip with speech.</p>}
      <Check checked={opts.denoise} onChange={(denoise) => set({ denoise })}>
        AI noise removal (RNNoise neural network)
      </Check>
      {opts.denoise && <SliderRow label="Strength" value={opts.denoiseStrength} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(denoiseStrength) => set({ denoiseStrength })} />}
      <Field label="Voice clarity">
        <Select<VoicePreset>
          ariaLabel="Voice clarity"
          value={opts.voice}
          onChange={(voice) => set({ voice })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'light', label: 'Light' },
            { value: 'clear', label: 'Clear voice' },
            { value: 'strong', label: 'Strong (podcast)' },
          ]}
        />
      </Field>
      <Check checked={opts.normalize} onChange={(normalize) => set({ normalize })}>
        Normalise speech loudness
      </Check>
      <div className="flex gap-1.5">
        <Button className="flex-1 px-1!" disabled={!ok || preview.rendering} onClick={() => play('original')} aria-pressed={preview.playing === 'original'}>
          {preview.playing === 'original' ? <Square size={11} /> : <Headphones size={12} />} Original
        </Button>
        <Button className="flex-1 px-1!" disabled={!ok || preview.rendering} onClick={() => play('enhanced')} aria-pressed={preview.playing === 'enhanced'}>
          {preview.rendering ? <Loader2 size={12} className="animate-spin" /> : preview.playing === 'enhanced' ? <Square size={11} /> : <Headphones size={12} />} Enhanced
        </Button>
      </div>
      <p className="text-[10px] text-fg-subtle">Preview plays 8 seconds from the playhead (or the clip start).</p>
      <Button variant="primary" className="w-full" disabled={!ok || running} onClick={() => clip && void enhanceClip(clip.id, opts)}>
        {running ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Apply to clip
      </Button>
      <Button className="w-full" disabled={running} onClick={() => void balanceVolumes()} title="Bring every audible clip to the same speech loudness">
        <SlidersVertical size={13} /> Balance all clip volumes
      </Button>
      <AiJobList kinds={['enhance']} />
    </PropertySection>
  );
}

// ---- Smart cuts -------------------------------------------------------------------------------

const TYPE_LABEL: Record<Suggestion['type'], string> = {
  scene: 'Scene change',
  duplicate: 'Repeated take',
  silence: 'Long pause',
  static: 'Nothing happens',
  dark: 'Dark footage',
  blurry: 'Blurry',
};

function SmartCutsSection() {
  const { clip, media } = useSelectedClip();
  const res = useAiResults((s) => s.scenes);
  const fresh = useIsFresh(res);
  const running = useJobRunning('scenes');
  const pending = res?.suggestions.filter((s) => s.status === 'pending') ?? [];
  const cuts = pending.filter((s) => s.type !== 'scene');
  const splits = pending.filter((s) => s.type === 'scene');
  return (
    <PropertySection title="Smart cuts">
      <p className="text-[11px] leading-relaxed text-fg-subtle">Analyses a video clip: scene changes, repeated takes, long pauses, frozen, dark or blurry footage. Accept or reject each suggestion.</p>
      <Button className="w-full" disabled={running || !clip || media?.kind !== 'video'} onClick={() => clip && void analyzeClip(clip.id)}>
        {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {clip && media?.kind === 'video' ? 'Analyse selected clip' : 'Select a video clip'}
      </Button>
      <AiJobList kinds={['scenes']} />
      {res && (
        <div className="space-y-1.5" data-testid="smart-suggestions">
          {!fresh && <Stale />}
          <div className="text-[11px] text-fg-muted">
            {res.clipName}: {res.cuts.length} scene changes · {cuts.length} suggested cuts
          </div>
          <div className="flex gap-1.5">
            <Button className="flex-1 px-1!" disabled={!fresh || !cuts.length} onClick={() => acceptAllSuggestions('cuts')}>
              Apply all cuts
            </Button>
            <Button className="flex-1 px-1!" disabled={!fresh || !splits.length} onClick={() => acceptAllSuggestions('splits')}>
              Split at scenes
            </Button>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {res.suggestions.map((s) => (
              <div key={s.id} data-testid="suggestion" data-type={s.type} className={cn('rounded-md border border-line p-1.5 text-[11px]', s.status !== 'pending' && 'opacity-50')}>
                <div className="flex items-center gap-1">
                  <span className={cn('font-medium', s.type === 'scene' ? 'text-accent' : 'text-warning')}>{TYPE_LABEL[s.type]}</span>
                  <button type="button" className="font-mono text-fg-subtle hover:text-accent" onClick={() => previewEngine.seek(s.start)}>
                    {fmtTime(s.start)}
                    {s.type !== 'scene' && ` – ${fmtTime(s.end)}`}
                  </button>
                  {s.status === 'pending' ? (
                    <span className="ml-auto flex gap-0.5">
                      <button type="button" aria-label={`Accept ${TYPE_LABEL[s.type]}`} disabled={!fresh} onClick={() => acceptSuggestion(s.id)} className="rounded p-0.5 text-success hover:bg-hover disabled:opacity-40">
                        <CheckIcon size={13} />
                      </button>
                      <button type="button" aria-label={`Reject ${TYPE_LABEL[s.type]}`} onClick={() => rejectSuggestion(s.id)} className="rounded p-0.5 text-fg-muted hover:bg-hover">
                        <X size={13} />
                      </button>
                    </span>
                  ) : (
                    <span className="ml-auto text-[10px] text-fg-subtle">{s.status}</span>
                  )}
                </div>
                <div className="text-[10px] text-fg-subtle">{s.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PropertySection>
  );
}

// ---- Background ----------------------------------------------------------------------------

function BackgroundToolSection() {
  const { clip, media, locked } = useSelectedClip();
  const visual = !!clip && !!media && (media.kind === 'video' || media.kind === 'image');
  return (
    <PropertySection title="Background removal" defaultOpen={false}>
      {visual ? <BackgroundControls clip={clip!} locked={locked} /> : <p className="text-[11px] text-fg-subtle">Select a video or image clip showing a person.</p>}
    </PropertySection>
  );
}

// ---- Summary & highlights ---------------------------------------------------------------------

function SummarySection() {
  const res = useAiResults((s) => s.summary);
  const fresh = useIsFresh(res);
  const running = useJobRunning('summary');
  const [target, setTarget] = useState(30);
  const r = res?.result;
  const selected = useMemo(() => r?.highlights.filter((h) => h.selected) ?? [], [r]);
  return (
    <PropertySection title="Summary & highlights">
      <p className="text-[11px] leading-relaxed text-fg-subtle">Summarises what is said (uses the captions, or transcribes first) and picks the best moments. The summary is made of the video's own sentences.</p>
      <Field label="Highlight length">
        <Select ariaLabel="Highlight length" value={target} onChange={setTarget} options={[10, 15, 30, 60].map((v) => ({ value: v, label: `${v} seconds` }))} />
      </Field>
      <Button className="w-full" disabled={running} onClick={() => void summarizeTimeline(target)}>
        {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Summarise video
      </Button>
      <AiJobList kinds={['summary']} />
      {r && (
        <div className="space-y-2" data-testid="summary-result">
          {!fresh && <Stale />}
          {r.summary.length > 0 && (
            <div className="space-y-1 rounded-md bg-panel-2 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Summary</div>
              {r.summary.map((s, i) => (
                <p key={i} dir="auto" className="text-[12px] leading-snug text-fg">
                  {s}
                </p>
              ))}
              {r.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {r.keywords.map((k) => (
                    <span key={k} className="rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-fg-muted">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Important moments</div>
          {r.moments.map((m, i) => (
            <button key={i} type="button" onClick={() => previewEngine.seek(m.time)} className="flex w-full gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-hover">
              <span className="font-mono text-accent">{fmtTime(m.time)}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-fg-muted">
                {m.label}
              </span>
            </button>
          ))}
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Highlights</div>
          {r.highlights.map((h) => (
            <label key={h.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-hover">
              <input type="checkbox" checked={h.selected} onChange={() => toggleHighlight(h.id)} />
              <button type="button" className="font-mono text-fg-muted hover:text-accent" onClick={() => previewEngine.seek(h.start)}>
                {fmtTime(h.start)}
              </button>
              <span dir="auto" className="min-w-0 flex-1 truncate text-fg-subtle">
                {h.label}
              </span>
              <span className="font-mono text-fg-subtle">{(h.end - h.start).toFixed(1)}s</span>
            </label>
          ))}
          <Button variant="primary" className="w-full" disabled={!fresh || !selected.length} onClick={insertHighlights}>
            <Scissors size={13} /> Insert highlight reel ({selected.reduce((s, h) => s + h.end - h.start, 0).toFixed(1)} s)
          </Button>
          <p className="text-[10px] text-fg-subtle">Based on: {r.basedOn.join(', ') || 'pictures only'}. The reel is added after the end of the edit as normal clips.</p>
        </div>
      )}
    </PropertySection>
  );
}

export function AiToolsPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ai-panel">
      <PanelHeader title="AI tools" />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 border-b border-line p-3">
          <LocalBadge>Every AI tool here runs on this device: free, offline after the first model download, and your video is never uploaded. No API key is needed.</LocalBadge>
        </div>
        <SilenceSection />
        <EnhanceSection />
        <SmartCutsSection />
        <BackgroundToolSection />
        <SummarySection />
      </div>
    </div>
  );
}
