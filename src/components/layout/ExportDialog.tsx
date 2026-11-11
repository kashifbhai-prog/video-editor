import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, Download, FileJson, Film, Loader2, RotateCcw, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useProjectStore } from '../../store/projectStore';
import { useMediaStore } from '../../store/mediaStore';
import { exportProjectFile } from '../../services/projectService';
import {
  cancelExport,
  clearExportResult,
  getExportSettings,
  refreshCapabilities,
  setExportSettings,
  startExport,
  useExportStore,
} from '../../services/exportService';
import {
  applyPreset,
  EXPORT_FRAME_RATES,
  EXPORT_RESOLUTIONS,
  exportSize,
  formatBitrate,
  presetBitrate,
  PRESETS,
  safeFileName,
  VIDEO_CODEC_LABEL,
} from '../../engine/export/exportSettings';
import type { ExportStage } from '../../engine/export/exporter';
import { ASPECT_RATIOS } from '../../utils/canvas';
import { sequenceDuration } from '../../engine/timelineModel';
import { formatBytes, formatDuration } from '../../utils/format';
import type { AspectRatio, ExportPreset, ExportResolution, ExportVideoCodec, FrameRate } from '../../types';
import { Dialog } from '../controls/Dialog';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { InfoRow, PropertyRow } from '../properties/PropertySection';
import { cn } from '../../utils/cn';

const STAGE_LABEL: Record<ExportStage, string> = {
  prepare: 'Preparing media (demuxing & decoders)',
  audio: 'Mixing audio',
  video: 'Rendering & encoding video',
  finalize: 'Writing MP4 file',
  verify: 'Verifying output',
};

const AUDIO_BITRATES = [96_000, 128_000, 160_000, 192_000, 256_000, 320_000];

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function SettingsView() {
  const doc = useProjectStore((s) => s.document);
  const setAspectRatio = useProjectStore((s) => s.setAspectRatio);
  const caps = useExportStore((s) => s.capabilities);
  const probing = useExportStore((s) => s.probing);
  const settings = useExportStore((s) => s.settings) ?? getExportSettings();
  const missing = useMediaStore((s) => Object.values(doc.clips).filter((c) => !c.text && s.items.find((m) => m.id === c.mediaId)?.status !== 'ready').length);
  const duration = sequenceDuration(doc);
  const { width, height } = exportSize(doc.canvas.aspectRatio, settings.resolution);
  const resSupport = caps?.video[settings.videoCodec].find((r) => r.resolution === settings.resolution);
  const hasAudio = useMediaStore((s) => Object.values(doc.clips).some((c) => ['audio', 'video'].includes(s.items.find((m) => m.id === c.mediaId)?.kind ?? '')));
  const estBytes = ((settings.videoBitrate + (caps?.audioCodec && hasAudio ? settings.audioBitrate : 0)) * duration) / 8;

  // Re-probe when aspect or frame rate change (encoder support depends on both).
  useEffect(() => {
    void refreshCapabilities();
  }, [doc.canvas.aspectRatio, settings.frameRate]);

  const custom = (patch: Partial<typeof settings>) => setExportSettings({ ...patch, preset: 'custom' });
  const setPreset = (preset: ExportPreset) => setExportSettings(applyPreset(settings, preset, doc.canvas.aspectRatio));
  const codecSupported = (c: ExportVideoCodec) => !!caps?.video[c].some((r) => r.supported);

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Quality preset" className="grid grid-cols-4 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={settings.preset === p.value}
            title={p.description}
            onClick={() => setPreset(p.value)}
            className={cn(
              'rounded-md border px-2 py-1.5 text-[11px] transition-colors',
              settings.preset === p.value ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong text-fg-muted hover:text-fg',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-[11px] text-fg-subtle">{PRESETS.find((p) => p.value === settings.preset)?.description}</p>

      <div className="space-y-2.5">
        <PropertyRow label="File name">
          <div className="flex items-center gap-1">
            <input
              aria-label="Output file name"
              className="field"
              value={settings.fileName}
              onChange={(e) => setExportSettings({ fileName: e.target.value })}
              onBlur={(e) => setExportSettings({ fileName: safeFileName(e.target.value) })}
            />
            <span className="text-[11px] text-fg-subtle">.mp4</span>
          </div>
        </PropertyRow>
        <PropertyRow label="Aspect ratio">
          <Select<AspectRatio>
            ariaLabel="Export aspect ratio"
            value={doc.canvas.aspectRatio}
            options={ASPECT_RATIOS.map((a) => ({ value: a.value, label: `${a.label} – ${a.hint.split(' · ')[0]}` }))}
            onChange={(a) => setAspectRatio(a)}
          />
        </PropertyRow>
        <PropertyRow label="Resolution">
          <Select<ExportResolution>
            ariaLabel="Export resolution"
            value={settings.resolution}
            options={EXPORT_RESOLUTIONS.map((r) => {
              const sup = caps?.video[settings.videoCodec].find((x) => x.resolution === r.value);
              const size = exportSize(doc.canvas.aspectRatio, r.value);
              return { value: r.value, label: `${r.label} (${size.width}×${size.height})${sup && !sup.supported ? ' – unavailable' : ''}` };
            })}
            onChange={(resolution) => {
              const s = exportSize(doc.canvas.aspectRatio, resolution);
              const p = settings.preset === 'custom' ? 'standard' : settings.preset;
              setExportSettings({ resolution, preset: 'custom', videoBitrate: presetBitrate(p, s.width, s.height, settings.frameRate, settings.videoCodec) });
            }}
          />
        </PropertyRow>
        <PropertyRow label="Frame rate">
          <Select<FrameRate>
            ariaLabel="Export frame rate"
            value={settings.frameRate}
            options={EXPORT_FRAME_RATES.map((f) => ({ value: f, label: `${f} fps${f === doc.canvas.frameRate ? ' (project)' : ''}` }))}
            onChange={(frameRate) => custom({ frameRate })}
          />
        </PropertyRow>
        <PropertyRow label="Video codec">
          <Select<ExportVideoCodec>
            ariaLabel="Video codec"
            value={settings.videoCodec}
            options={(['avc', 'hevc'] as const).map((c) => ({ value: c, label: `${VIDEO_CODEC_LABEL[c]}${caps && !codecSupported(c) ? ' – unavailable' : ''}` }))}
            onChange={(videoCodec) => custom({ videoCodec })}
          />
        </PropertyRow>
        <PropertyRow label={`Video bitrate`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label="Video bitrate"
              min={0.5}
              max={80}
              step={0.5}
              value={settings.videoBitrate / 1e6}
              onChange={(e) => custom({ videoBitrate: Number(e.target.value) * 1e6 })}
              className="range w-full"
              style={{ ['--fill' as string]: `${(settings.videoBitrate / 80e6) * 100}%` }}
            />
            <span className="w-16 shrink-0 text-right font-mono text-[11px]">{formatBitrate(settings.videoBitrate)}</span>
          </div>
        </PropertyRow>
        <PropertyRow label="Audio bitrate">
          <Select<number>
            ariaLabel="Audio bitrate"
            value={settings.audioBitrate}
            options={AUDIO_BITRATES.map((b) => ({ value: b, label: `${b / 1000} kbps` }))}
            onChange={(audioBitrate) => custom({ audioBitrate })}
          />
        </PropertyRow>
      </div>

      <div className="space-y-1.5 rounded-md border border-line bg-panel-2 p-3" data-testid="export-summary">
        <InfoRow label="Output" value={<span className="font-mono">{width} × {height} · {settings.frameRate} fps · MP4</span>} />
        <InfoRow label="Video" value={`${VIDEO_CODEC_LABEL[settings.videoCodec]} · ${formatBitrate(settings.videoBitrate)}${caps ? (caps.hardwareAvc ? ' · hardware encoder available' : ' · software encoder') : ''}`} />
        <InfoRow
          label="Audio"
          value={
            !hasAudio
              ? 'No audio clips'
              : caps
                ? caps.audioCodec
                  ? `${caps.audioCodec === 'aac' ? 'AAC' : 'Opus'} · ${settings.audioBitrate / 1000} kbps · 48 kHz stereo`
                  : 'No audio encoder in this browser – the video will be exported WITHOUT audio'
                : 'Checking…'
          }
        />
        <InfoRow label="Duration" value={formatDuration(duration)} />
        <InfoRow label="Estimated size" value={`≈ ${formatBytes(estBytes)}`} />
      </div>

      {probing && !caps && (
        <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <Loader2 size={12} className="animate-spin" /> Checking encoder support…
        </p>
      )}
      {caps && !caps.webCodecs && (
        <Warn>This browser has no WebCodecs video encoder, so it cannot render video files. Use a recent Chrome, Edge or Safari 16.4+ / Firefox 130+.</Warn>
      )}
      {resSupport && !resSupport.supported && <Warn>{resSupport.reason}. Choose a lower resolution or the other codec.</Warn>}
      {missing > 0 && <Warn>{missing} clip(s) have missing media and must be removed or re-imported before exporting.</Warn>}
      {Object.values(doc.clips).some((c) => c.reversed) && (
        <p className="text-[11px] text-fg-subtle">Reversed clips are exported silent (as in the preview); their picture is rendered backwards.</p>
      )}

      <div className="flex items-start gap-3 rounded-md border border-line p-3">
        <FileJson size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="flex-1">
          <div className="text-[12px] font-medium">Project file (.json)</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">Settings, tracks and media list – for backups and inspection.</p>
        </div>
        <Button
          onClick={() => {
            exportProjectFile();
            useUiStore.getState().notify('Project file downloaded.', 'success');
          }}
        >
          Download
        </Button>
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-relaxed text-warning">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ProgressView() {
  const progress = useExportStore((s) => s.progress);
  const startedAt = useExportStore((s) => s.startedAt);
  const settings = useExportStore((s) => s.settings) ?? getExportSettings();
  const aspect = useProjectStore((s) => s.document.canvas.aspectRatio);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(iv);
  }, []);
  const elapsed = (now - startedAt) / 1000;
  const p = progress?.progress ?? 0;
  // ETA from the rendering stage's frame rate (the dominant stage).
  const eta = p > 0.15 && p < 1 ? (elapsed / p) * (1 - p) : null;
  const { width, height } = exportSize(aspect, settings.resolution);
  return (
    <div className="space-y-4" data-testid="export-progress">
      <div className="flex items-center gap-2 text-[12px]">
        <Loader2 size={14} className="animate-spin text-accent" />
        <span>{progress ? STAGE_LABEL[progress.stage] : 'Starting…'}</span>
      </div>
      <div className="space-y-1.5">
        <div
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p * 100)}
          className="h-2 overflow-hidden rounded-full bg-panel-3"
        >
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${p * 100}%` }} />
        </div>
        <div className="flex justify-between font-mono text-[11px] text-fg-muted">
          <span>{Math.floor(p * 100)}%</span>
          {progress && progress.frames > 0 && (
            <span>
              frame {progress.frame} / {progress.frames}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1.5 rounded-md border border-line bg-panel-2 p-3">
        <InfoRow label="Elapsed" value={<span className="font-mono">{fmtClock(elapsed)}</span>} />
        <InfoRow label="Remaining" value={<span className="font-mono">{eta !== null ? `≈ ${fmtClock(eta)}` : '—'}</span>} />
        <InfoRow label="Output" value={`${width} × ${height} · ${settings.frameRate} fps`} />
      </div>
      <p className="text-[11px] text-fg-subtle">You can keep editing other panels; don't close this tab until the export finishes.</p>
    </div>
  );
}

function ResultView() {
  const r = useExportStore((s) => s.result)!;
  return (
    <div className="space-y-3" data-testid="export-result">
      <div className="flex items-center gap-1.5 text-[12px] text-success">
        <CheckCircle2 size={14} /> Export complete and verified
      </div>
      <video src={r.url} controls className="aspect-video w-full rounded-md bg-black" aria-label="Exported video" />
      <div className="space-y-1.5 rounded-md border border-line bg-panel-2 p-3">
        <InfoRow label="File" value={r.fileName} />
        <InfoRow label="Size" value={formatBytes(r.size)} />
        <InfoRow label="Duration" value={`${r.duration.toFixed(2)} s`} />
        <InfoRow label="Resolution" value={`${r.width} × ${r.height} · ${r.frameRate} fps`} />
        <InfoRow label="Codecs" value={`${r.videoCodec}${r.audioCodec ? ` + ${r.audioCodec}` : ' (no audio)'}`} />
        <InfoRow
          label="Rendered in"
          value={
            <span className="inline-flex items-center gap-1">
              <Cpu size={11} /> {r.renderSeconds.toFixed(1)} s · {r.hardwareEncoding ? 'hardware' : 'software'} encoder
            </span>
          }
        />
      </div>
      {r.audioSkipped.length > 0 && (
        <p className="text-[11px] text-fg-subtle">Silent in the export (as in the preview): {r.audioSkipped.map((s) => `${s.name} – ${s.reason}`).join('; ')}</p>
      )}
    </div>
  );
}

export function ExportDialog() {
  const status = useExportStore((s) => s.status);
  const error = useExportStore((s) => s.error);
  const caps = useExportStore((s) => s.capabilities);
  const settings = useExportStore((s) => s.settings) ?? getExportSettings();
  const result = useExportStore((s) => s.result);
  const hasClips = useProjectStore((s) => Object.keys(s.document.clips).length > 0);
  const aspect = useProjectStore((s) => s.document.canvas.aspectRatio);
  const missingCount = useMediaStore((s) => {
    const clips = useProjectStore.getState().document.clips;
    return Object.values(clips).filter((c) => !c.text && s.items.find((m) => m.id === c.mediaId)?.status !== 'ready').length;
  });
  const close = () => useUiStore.getState().openDialog(null);
  const supported = !!caps?.video[settings.videoCodec].find((r) => r.resolution === settings.resolution)?.supported;
  const canExport = hasClips && supported && missingCount === 0 && !!settings.fileName.trim();
  const size = useMemo(() => exportSize(aspect, settings.resolution), [aspect, settings.resolution]);

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (status === 'running') {
    body = <ProgressView />;
    footer = (
      <>
        <Button onClick={close}>Hide</Button>
        <Button variant="danger" onClick={cancelExport}>
          <X size={13} /> Cancel export
        </Button>
      </>
    );
  } else if (status === 'done' && result) {
    body = <ResultView />;
    footer = (
      <>
        <Button onClick={() => clearExportResult()}>
          <RotateCcw size={13} /> Export again
        </Button>
        <a
          href={result.url}
          download={result.fileName}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover"
        >
          <Download size={13} /> Download {result.fileName}
        </a>
      </>
    );
  } else {
    body = (
      <>
        {status === 'error' && error && (
          <div className="mb-4">
            <Warn>{error}</Warn>
          </div>
        )}
        {status === 'cancelled' && <p className="mb-4 text-[11px] text-fg-muted">Export cancelled. Nothing was saved.</p>}
        <SettingsView />
      </>
    );
    footer = (
      <>
        <Button onClick={close}>Close</Button>
        <Button variant="primary" disabled={!canExport} onClick={() => void startExport()}>
          <Film size={13} /> Export {size.width}×{size.height}
        </Button>
      </>
    );
  }
  return (
    <Dialog title="Export" onClose={close} footer={footer} width={520}>
      {!hasClips && status !== 'running' && !result ? <p className="mb-3 text-[11px] text-fg-muted">The timeline is empty – add clips to export a video.</p> : null}
      {body}
    </Dialog>
  );
}
