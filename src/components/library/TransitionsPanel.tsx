import { TRANSITIONS, type TransitionDef } from '../../engine/catalog';
import { applyTransitionToSelection } from '../../services/advancedEditing';
import { LIBRARY_DRAG_MIME, setDraggedLibraryItem } from '../timeline/dragStore';
import { GroupLabel, PanelHeader, PanelHint } from './PanelChrome';

const CATEGORIES = ['Basic', 'Wipe', 'Motion', 'Blur'] as const;

/** Two-panel demo: A (outgoing) underneath, B (incoming) animated on top while hovered. */
function Demo({ def }: { def: TransitionDef }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-black">
      <div className={`absolute inset-0 bg-gradient-to-br from-[#4f8cff] to-[#22336b] ${def.type === 'fade' ? 'tr-demo tr-fade-out' : ''}`}>
        <span className="absolute left-1.5 top-1 text-[10px] font-bold text-white/80">A</span>
      </div>
      <div className={`tr-demo tr-${def.type === 'crossfade' ? 'cross' : def.type} absolute inset-0 bg-gradient-to-br from-[#ff8a4c] to-[#a8324a]`}>
        <span className="absolute bottom-1 right-1.5 text-[10px] font-bold text-white/80">B</span>
      </div>
    </div>
  );
}

export function TransitionsPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Transitions" count={TRANSITIONS.length} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHint>
          Drag a transition onto the cut between two touching clips, or select a clip and click a transition to apply it to its cut.
          Hover a tile to preview it.
        </PanelHint>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <GroupLabel>{cat}</GroupLabel>
            <div className="grid grid-cols-2 gap-2 px-3">
              {TRANSITIONS.filter((t) => t.category === cat).map((def) => (
                <button
                  key={def.type}
                  type="button"
                  draggable
                  aria-label={`Transition ${def.name}`}
                  title={`${def.name} – drag onto a cut, or click to apply to the selected clip`}
                  onClick={() => applyTransitionToSelection(def.type)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify({ kind: 'transition', type: def.type }));
                    e.dataTransfer.effectAllowed = 'copy';
                    setDraggedLibraryItem({ kind: 'transition', type: def.type });
                  }}
                  onDragEnd={() => setDraggedLibraryItem(null)}
                  className="group space-y-1 rounded-md p-1 text-left transition-colors hover:bg-hover"
                >
                  <Demo def={def} />
                  <div className="truncate px-0.5 text-[11px] text-fg">{def.name}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
