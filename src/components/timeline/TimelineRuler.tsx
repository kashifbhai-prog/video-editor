import { memo, useEffect, useMemo, useRef } from 'react';
import { formatRulerLabel } from '../../utils/format';
import { usePlaybackStore } from '../../store/playbackStore';
import { getTickSpacing, RULER_HEIGHT } from './timelineConfig';

interface TimelineRulerProps {
  pxPerSecond: number;
  totalSeconds: number;
  /** Visible horizontal window in content pixels; ticks outside are not rendered. */
  viewStart: number;
  viewWidth: number;
  onScrubStart: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const TimelineRuler = memo(function TimelineRuler({
  pxPerSecond,
  totalSeconds,
  viewStart,
  viewWidth,
  onScrubStart,
}: TimelineRulerProps) {
  const { major, minor } = getTickSpacing(pxPerSecond);
  const ref = useRef<HTMLDivElement>(null);

  // Accessibility value follows the timeline playhead, written directly to the
  // DOM so ~100 tick elements are not re-rendered on every playback frame.
  useEffect(() => {
    const apply = (t: number) => {
      ref.current?.setAttribute('aria-valuenow', String(Math.round(t * 100) / 100));
      ref.current?.setAttribute('aria-valuetext', formatRulerLabel(t));
    };
    apply(usePlaybackStore.getState().timelineTime);
    return usePlaybackStore.subscribe((s, prev) => s.timelineTime !== prev.timelineTime && apply(s.timelineTime));
  }, []);

  const ticks = useMemo(() => {
    const out: { x: number; t: number; isMajor: boolean }[] = [];
    const margin = 200;
    const startT = Math.max(0, Math.floor((viewStart - margin) / pxPerSecond / minor) * minor);
    const endT = Math.min(totalSeconds, (viewStart + viewWidth + margin) / pxPerSecond);
    const ratio = Math.round(major / minor);
    for (let i = Math.round(startT / minor); i * minor <= endT + 1e-9; i++) {
      const t = i * minor;
      out.push({ x: t * pxPerSecond, t, isMajor: i % ratio === 0 });
    }
    return out;
  }, [pxPerSecond, totalSeconds, viewStart, viewWidth, major, minor]);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Timeline ruler – click or drag to move the playhead"
      aria-valuemin={0}
      aria-valuemax={totalSeconds}
      className="relative h-full cursor-pointer select-none"
      style={{ width: totalSeconds * pxPerSecond, height: RULER_HEIGHT }}
      onPointerDown={onScrubStart}
    >
      {ticks.map(({ x, t, isMajor }) => (
        <div key={t.toFixed(3)} className="absolute bottom-0" style={{ left: x }}>
          <div className={isMajor ? 'h-2.5 w-px bg-fg-subtle' : 'h-1.5 w-px bg-line-strong'} />
          {isMajor && (
            <span className="absolute bottom-3 left-1 whitespace-nowrap font-mono text-[10px] text-fg-subtle">
              {formatRulerLabel(t)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});
