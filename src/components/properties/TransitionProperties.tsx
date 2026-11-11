import { Trash2 } from 'lucide-react';
import { MIN_TRANSITION_DURATION, TRANSITIONS } from '../../engine/catalog';
import { maxTransitionDuration, useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { previewEngine } from '../../engine/previewEngine';
import { isContinuousSplit } from '../../engine/sequence';
import type { Transition, TransitionType } from '../../types';
import { Button } from '../controls/Button';
import { Select } from '../controls/Select';
import { InfoRow, PropertyRow, PropertySection } from './PropertySection';
import { SliderRow } from './controls';

export function TransitionProperties({ transition }: { transition: Transition }) {
  const from = useProjectStore((s) => s.document.clips[transition.fromClipId]);
  const to = useProjectStore((s) => s.document.clips[transition.toClipId]);
  const max = useProjectStore((s) => maxTransitionDuration(s.document, transition.fromClipId, transition.toClipId));
  const locked = useProjectStore((s) => !!s.document.tracks.find((t) => t.id === from?.trackId)?.locked);
  const update = useProjectStore((s) => s.updateTransition);
  const remove = useProjectStore((s) => s.removeTransition);
  const setSelection = useUiStore((s) => s.setSelection);
  if (!from || !to) return null;
  const cut = to.start;
  const split = isContinuousSplit(from, to);

  return (
    <>
      <PropertySection title="Transition">
        <PropertyRow label="Type">
          <Select<TransitionType>
            ariaLabel="Transition type"
            value={transition.type}
            options={TRANSITIONS.map((t) => ({ value: t.type, label: t.name }))}
            onChange={(type) => !locked && update(transition.id, { type })}
          />
        </PropertyRow>
        <SliderRow
          label="Duration"
          value={transition.duration}
          min={MIN_TRANSITION_DURATION}
          max={max}
          step={0.05}
          format={(v) => `${v.toFixed(2)}s`}
          disabled={locked}
          onChange={(duration) => update(transition.id, { duration }, `transition.${transition.id}.duration`)}
        />
        <InfoRow label="From" value={from.name} />
        <InfoRow label="To" value={to.name} />
        <InfoRow label="Window" value={<span className="font-mono">{(cut - transition.duration / 2).toFixed(2)}s → {(cut + transition.duration / 2).toFixed(2)}s</span>} />
        <p className="text-[10px] leading-relaxed text-fg-subtle">
          {split
            ? 'Centred on the cut. This cut splits one continuous video, so the outgoing clip freezes on its frame while the video plays on underneath (the sound continues unchanged).'
            : 'Centred on the cut. Each clip uses media beyond its in/out point when available, otherwise it holds its first / last frame. Audio crossfades across the same window.'}
        </p>
        <Button
          className="w-full"
          onClick={() => {
            useUiStore.getState().showTimeline();
            previewEngine.seek(Math.max(0, cut - transition.duration / 2 - 0.5));
            previewEngine.play();
          }}
        >
          Preview transition
        </Button>
      </PropertySection>
      <div className="p-3">
        <Button
          variant="danger"
          className="w-full"
          disabled={locked}
          onClick={() => {
            remove(transition.id);
            setSelection({ kind: 'none' });
          }}
        >
          <Trash2 size={13} /> Remove transition
        </Button>
      </div>
    </>
  );
}
