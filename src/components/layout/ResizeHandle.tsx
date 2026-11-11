import { useCallback, useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { prefsStorage } from '../../utils/storage';
import { cn } from '../../utils/cn';

/** Horizontal splitter that resizes the timeline height by dragging. */
export function TimelineResizeHandle() {
  const setHeight = useUiStore((s) => s.setTimelineHeight);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = useUiStore.getState().timelineHeight;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      setDragging(true);
      const move = (ev: PointerEvent) => setHeight(startH + (startY - ev.clientY));
      const up = () => {
        setDragging(false);
        prefsStorage.save({ timelineHeight: useUiStore.getState().timelineHeight });
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [setHeight],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline (double-click to reset)"
      title="Drag to resize the timeline · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        setHeight(280);
        prefsStorage.save({ timelineHeight: 280 });
      }}
      className="group relative z-10 h-1 shrink-0 cursor-row-resize bg-line"
    >
      <div
        className={cn(
          'absolute inset-x-0 -top-1 -bottom-1 transition-colors',
          dragging ? 'bg-accent/60' : 'group-hover:bg-accent/40',
        )}
      />
    </div>
  );
}
