import { useAiResults, useIsFresh } from '../../services/ai/aiStore';
import { toggleSilence } from '../../services/ai/silence';
import { HEADER_WIDTH, RULER_HEIGHT } from '../timeline/timelineConfig';

/**
 * Review layer over the timeline tracks: detected pauses (red = will be
 * removed, grey = kept), suggested cuts (amber) and scene changes (blue).
 * Shown only while the analysis still matches the timeline.
 */
export function AiTimelineOverlay({ pps }: { pps: number }) {
  const silence = useAiResults((s) => s.silence);
  const scenes = useAiResults((s) => s.scenes);
  const silenceFresh = useIsFresh(silence);
  const scenesFresh = useIsFresh(scenes);
  const x = (t: number) => HEADER_WIDTH + t * pps;
  return (
    <>
      {silenceFresh &&
        silence!.ranges.map((r, i) => (
          <div
            key={`s${i}`}
            data-testid="silence-band"
            data-selected={r.selected}
            className="absolute bottom-0 z-[14]"
            style={{ left: x(r.start), width: Math.max(2, (r.end - r.start) * pps), top: RULER_HEIGHT }}
          >
            <div
              className="pointer-events-none absolute inset-0 border-x"
              style={{
                borderColor: r.selected ? 'rgba(239,68,68,0.8)' : 'rgba(160,160,170,0.6)',
                background: r.selected
                  ? 'repeating-linear-gradient(135deg, rgba(239,68,68,0.22) 0 6px, rgba(239,68,68,0.08) 6px 12px)'
                  : 'rgba(160,160,170,0.08)',
              }}
            />
            <button
              type="button"
              title={r.selected ? 'Pause will be removed – click to keep it' : 'Pause will be kept – click to remove it'}
              aria-label={`${r.selected ? 'Keep' : 'Remove'} pause ${r.start.toFixed(2)}–${r.end.toFixed(2)} s`}
              onClick={() => toggleSilence(i)}
              className="absolute left-0 right-0 top-0 h-3 text-[8px] leading-3 text-white"
              style={{ background: r.selected ? 'rgba(239,68,68,0.85)' : 'rgba(120,120,130,0.85)' }}
            >
              {(r.end - r.start) * pps > 28 ? `${(r.end - r.start).toFixed(1)}s` : ''}
            </button>
          </div>
        ))}
      {scenesFresh &&
        scenes!.suggestions
          .filter((s) => s.status === 'pending')
          .map((s) =>
            s.type === 'scene' ? (
              <div
                key={s.id}
                data-testid="scene-marker"
                title="Scene change"
                className="pointer-events-none absolute bottom-0 z-[14] w-0 border-l border-dashed border-sky-400"
                style={{ left: x(s.start), top: RULER_HEIGHT }}
              />
            ) : (
              <div
                key={s.id}
                data-testid="suggestion-band"
                title={s.reason}
                className="pointer-events-none absolute bottom-0 z-[14] border-x border-amber-400/80"
                style={{
                  left: x(s.start),
                  width: Math.max(2, (s.end - s.start) * pps),
                  top: RULER_HEIGHT,
                  background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.18) 0 6px, rgba(245,158,11,0.06) 6px 12px)',
                }}
              />
            ),
          )}
    </>
  );
}
