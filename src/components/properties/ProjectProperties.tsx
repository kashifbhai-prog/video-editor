import { useProjectStore } from '../../store/projectStore';
import { InlineTextInput } from '../controls/InlineTextInput';
import { sequenceDuration } from '../../engine/timelineModel';
import { formatDuration } from '../../utils/format';
import { useMediaStore } from '../../store/mediaStore';
import { ASPECT_RATIOS, FRAME_RATES, RESOLUTIONS, aspectToNumber, getCanvasSize } from '../../utils/canvas';
import { cn } from '../../utils/cn';
import type { FrameRate } from '../../types';
import { Select } from '../controls/Select';
import { InfoRow, PropertyRow, PropertySection } from './PropertySection';

/** Accepts "#RRGGBB" or "RRGGBB"; returns lowercase "#rrggbb" or null. */
function normalizeHex(raw: string): string | null {
  const v = raw.trim().replace(/^#?/, '#');
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

const BG_SWATCHES =['#000000', '#ffffff', '#1c1d22', '#6c7cff', '#22c3a6', '#f5a524', '#f0525f', '#2b2a4c'];

function AspectRatioPicker() {
  const value = useProjectStore((s) => s.document.canvas.aspectRatio);
  const setAspect = useProjectStore((s) => s.setAspectRatio);
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Aspect ratio">
      {ASPECT_RATIOS.map((a) => {
        const r = aspectToNumber(a.value);
        const w = r >= 1 ? 22 : 22 * r;
        const h = r >= 1 ? 22 / r : 22;
        const active = value === a.value;
        return (
          <button
            key={a.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={a.hint}
            onClick={() => setAspect(a.value)}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1.5 rounded-md border text-[10px] transition-colors',
              active ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-fg-muted hover:border-fg-subtle hover:text-fg',
            )}
          >
            <span className="flex h-6 items-center justify-center">
              <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: w, height: h }} />
            </span>
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

function BackgroundColorPicker() {
  const color = useProjectStore((s) => s.document.canvas.backgroundColor);
  const setColor = useProjectStore((s) => s.setBackgroundColor);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line-strong" style={{ background: color }}>
          <input
            type="color"
            aria-label="Background color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <InlineTextInput
          aria-label="Background color hex"
          value={color}
          maxLength={7}
          validate={normalizeHex}
          onCommit={setColor}
          className="field font-mono uppercase"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {BG_SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Use ${s}`}
            title={s}
            onClick={() => setColor(s)}
            className={cn(
              'h-5 w-5 rounded border transition-transform hover:scale-110',
              color.toLowerCase() === s ? 'border-accent ring-1 ring-accent' : 'border-line-strong',
            )}
            style={{ background: s }}
          />
        ))}
      </div>
    </div>
  );
}

export function ProjectProperties() {
  const canvas = useProjectStore((s) => s.document.canvas);
  const tracks = useProjectStore((s) => s.document.tracks.length);
  const clipsMap = useProjectStore((s) => s.document.clips);
  const editLength = sequenceDuration({ clips: clipsMap });
  const createdAt = useProjectStore((s) => s.createdAt);
  const setResolution = useProjectStore((s) => s.setResolution);
  const setFrameRate = useProjectStore((s) => s.setFrameRate);
  const media = useMediaStore((s) => s.items);
  const size = getCanvasSize(canvas.aspectRatio, canvas.resolution);

  return (
    <>
      <PropertySection title="Canvas">
        <PropertyRow label="Aspect ratio" stacked>
          <AspectRatioPicker />
        </PropertyRow>
        <PropertyRow label="Resolution">
          <Select
            ariaLabel="Resolution"
            value={canvas.resolution}
            options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label }))}
            onChange={setResolution}
          />
        </PropertyRow>
        <div className="flex justify-end font-mono text-[10px] text-fg-subtle">
          {size.width} × {size.height} px
        </div>
        <PropertyRow label="Frame rate" stacked>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Frame rate">
            {FRAME_RATES.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={canvas.frameRate === f}
                onClick={() => setFrameRate(f as FrameRate)}
                className={cn(
                  'h-7 rounded-md border text-[11px] transition-colors',
                  canvas.frameRate === f ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-fg-muted hover:text-fg',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Background">
        <BackgroundColorPicker />
      </PropertySection>

      <PropertySection title="Project info">
        <InfoRow label="Created" value={new Date(createdAt).toLocaleString()} />
        <InfoRow label="Tracks" value={tracks} />
        <InfoRow label="Clips" value={Object.keys(clipsMap).length} />
        <InfoRow label="Edit length" value={formatDuration(editLength)} />
        <InfoRow label="Media files" value={media.length} />
        <InfoRow
          label="Breakdown"
          value={`${media.filter((m) => m.kind === 'video').length} video · ${media.filter((m) => m.kind === 'image').length} image · ${media.filter((m) => m.kind === 'audio').length} audio`}
        />
      </PropertySection>
    </>
  );
}
