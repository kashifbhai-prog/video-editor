import { useEffect, useState, useSyncExternalStore } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { DEFAULT_MATTE, MATTE_MODEL_MB, matteEngine } from '../../engine/ai/matte';
import { useMediaStore } from '../../store/mediaStore';
import { disableBackgroundRemoval, putMediaBehind, setBackgroundRemoval } from '../../services/ai/background';
import type { Clip } from '../../types';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { ColorField, Segmented, SliderRow } from '../properties/controls';
import { PropertySection, Switch } from '../properties/PropertySection';
import { AiJobList, LocalBadge } from './AiShared';

const useMatteStatus = (model: 'fast' | 'quality') =>
  useSyncExternalStore(
    (cb) => matteEngine.subscribe(cb),
    () => matteEngine.statusOf(model),
  );

/** AI background removal controls for one video / image clip. */
export function BackgroundControls({ clip, locked }: { clip: Clip; locked: boolean }) {
  const m = { ...DEFAULT_MATTE, enabled: false, ...clip.matte };
  const status = useMatteStatus(m.model);
  const media = useMediaStore((s) => s.items);
  const behindOptions = media.filter((x) => x.status === 'ready' && x.kind !== 'audio' && x.id !== clip.mediaId);
  const [behind, setBehind] = useState(behindOptions[0]?.id ?? '');
  useEffect(() => {
    if (!behindOptions.some((o) => o.id === behind)) setBehind(behindOptions[0]?.id ?? '');
  }, [behindOptions, behind]);
  const k = (p: string) => `clip.${clip.id}.matte.${p}`;
  const set = (patch: Partial<typeof m>, key?: string) => setBackgroundRemoval(clip.id, patch, key && k(key));

  return (
    <div className="space-y-3" data-testid="background-controls">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-fg">Remove background</span>
        <Switch label="Remove background" checked={m.enabled} onChange={(on) => (on ? set({ enabled: true }) : disableBackgroundRemoval(clip.id))} />
      </div>
      <LocalBadge>Detects people (not other objects) on this device. Works in the preview and the exported video.</LocalBadge>
      {m.enabled && (
        <>
          {status === 'loading' && (
            <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <Loader2 size={12} className="animate-spin" /> Loading the {m.model} model ({MATTE_MODEL_MB[m.model]} MB, once)…
            </p>
          )}
          {status === 'error' && (
            <p role="alert" className="text-[11px] text-danger">
              The model could not be loaded: {matteEngine.errorOf(m.model)}. Check the internet connection and toggle again.
            </p>
          )}
          <AiJobList kinds={['background']} />
          <Segmented
            ariaLabel="Background replacement"
            value={m.mode}
            disabled={locked}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'transparent', label: 'Transparent', title: 'Show the layers below (or the canvas colour)' },
              { value: 'color', label: 'Colour', title: 'Solid colour background' },
              { value: 'blur', label: 'Blur', title: 'Blurred original background' },
            ]}
          />
          {m.mode === 'color' && <ColorField label="Background colour" value={m.color} disabled={locked} onChange={(color) => set({ color }, 'color')} />}
          {m.mode === 'blur' && <SliderRow label="Blur" value={m.blur} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} disabled={locked} onChange={(blur) => set({ blur }, 'blur')} />}
          <SliderRow label="Edge threshold" value={m.threshold} min={0.05} max={0.95} step={0.01} format={(v) => v.toFixed(2)} resetTo={DEFAULT_MATTE.threshold} disabled={locked} onChange={(threshold) => set({ threshold }, 'threshold')} />
          <SliderRow label="Edge softness" value={m.feather} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} resetTo={DEFAULT_MATTE.feather} disabled={locked} onChange={(feather) => set({ feather }, 'feather')} />
          <Segmented
            ariaLabel="Segmentation model"
            value={m.model}
            disabled={locked}
            onChange={(model) => set({ model })}
            options={[
              { value: 'quality', label: `Quality (${MATTE_MODEL_MB.quality} MB)`, title: 'Cleaner edges and hair; slower export' },
              { value: 'fast', label: `Fast (${MATTE_MODEL_MB.fast} MB)`, title: 'Faster; rougher edges' },
            ]}
          />
          {behindOptions.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-line p-2">
              <div className="text-[11px] text-fg-muted">Image or video background</div>
              <Select ariaLabel="Background media" value={behind} onChange={setBehind} options={behindOptions.map((o) => ({ value: o.id, label: o.name }))} />
              <Button className="w-full" disabled={locked || !behind} onClick={() => {
                if (m.mode !== 'transparent') set({ mode: 'transparent' });
                putMediaBehind(clip.id, behind);
              }}>
                <ImagePlus size={12} /> Put behind the person
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function BackgroundSection({ clip, locked }: { clip: Clip; locked: boolean }) {
  return (
    <PropertySection title="Background (AI)" defaultOpen={!!clip.matte?.enabled}>
      <BackgroundControls clip={clip} locked={locked} />
    </PropertySection>
  );
}
