import { Ban } from 'lucide-react';
import { FILTER_PRESETS } from '../../engine/catalog';
import { applyFilter } from '../../services/advancedEditing';
import { useProjectStore } from '../../store/projectStore';
import { cn } from '../../utils/cn';
import { LIBRARY_DRAG_MIME, setDraggedLibraryItem } from '../timeline/dragStore';
import { GroupLabel, PanelHeader, PanelHint, useSelectedClipIds } from './PanelChrome';

const CATEGORIES = ['Warm', 'Cool', 'Mono', 'Film', 'Vivid'] as const;

export function FiltersPanel() {
  const selected = useSelectedClipIds();
  // Highlight the filter of the selected clip (when exactly one is selected).
  const current = useProjectStore((s) => (selected.length === 1 ? s.document.clips[selected[0]]?.filter?.presetId ?? null : undefined));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Filters" count={FILTER_PRESETS.length} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHint>
          {selected.length ? 'Click a filter to apply it to the selected clips.' : 'Select a clip, then click a filter – or drag a filter onto a clip.'}{' '}
          Set its intensity and fine-tune colours under Properties → Adjust.
        </PanelHint>
        <div className="px-3 pt-2.5">
          <button
            type="button"
            onClick={() => applyFilter(null)}
            aria-pressed={current === null}
            className={cn(
              'flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-[11px] transition-colors',
              current === null ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong text-fg-muted hover:text-fg',
            )}
          >
            <Ban size={12} /> No filter
          </button>
        </div>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <GroupLabel>{cat}</GroupLabel>
            <div className="grid grid-cols-3 gap-2 px-3">
              {FILTER_PRESETS.filter((f) => f.category === cat).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  draggable
                  aria-label={`Filter ${f.name}`}
                  aria-pressed={current === f.id}
                  title={`${f.name} – click to apply, or drag onto a clip`}
                  onClick={() => applyFilter(f.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify({ kind: 'filter', presetId: f.id }));
                    e.dataTransfer.effectAllowed = 'copy';
                    setDraggedLibraryItem({ kind: 'filter', presetId: f.id });
                  }}
                  onDragEnd={() => setDraggedLibraryItem(null)}
                  className="group space-y-1 rounded-md p-1 text-center transition-colors hover:bg-hover"
                >
                  <div
                    className={cn('aspect-square rounded-md', current === f.id && 'ring-2 ring-accent ring-offset-1 ring-offset-panel')}
                    style={{ background: f.swatch }}
                  />
                  <div className="truncate text-[10px] text-fg">{f.name}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
