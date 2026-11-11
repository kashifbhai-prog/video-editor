import { Plus } from 'lucide-react';
import { DEFAULT_TEXT_STYLE, TEXT_PRESETS } from '../../engine/catalog';
import { isRtlText } from '../../engine/textRenderer';
import { addText } from '../../services/advancedEditing';
import { GroupLabel, PanelHeader, PanelHint } from './PanelChrome';

export function TextPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Text"
        action={
          <button
            type="button"
            onClick={() => addText()}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-white hover:bg-accent-hover"
          >
            <Plus size={13} strokeWidth={2.25} />
            Add text
          </button>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHint>
          Text is added at the playhead on a text track. Double-click text in the player to edit it; style and animate it in Properties.
          Arabic and Urdu are laid out right-to-left automatically.
        </PanelHint>
        <GroupLabel>Styles</GroupLabel>
        <div className="grid grid-cols-2 gap-2 px-3">
          {TEXT_PRESETS.map((p) => {
            const s = { ...DEFAULT_TEXT_STYLE, ...p.style };
            return (
              <button
                key={p.id}
                type="button"
                aria-label={`Add ${p.name} text`}
                onClick={() => addText(p)}
                className="group flex flex-col gap-1 rounded-md p-1 text-left transition-colors hover:bg-hover"
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-[#26272d] px-1.5">
                  <span
                    dir={isRtlText(p.content) ? 'rtl' : 'ltr'}
                    className="max-w-full truncate rounded-[3px] px-1"
                    style={{
                      fontFamily: `"${s.fontFamily}", "Segoe UI", Tahoma, sans-serif`,
                      fontWeight: s.fontWeight,
                      fontSize: Math.min(20, s.fontSize / 5),
                      color: s.color,
                      background: s.background ?? undefined,
                      letterSpacing: s.letterSpacing / 4,
                      WebkitTextStroke: s.outlineWidth ? `${Math.max(0.5, s.outlineWidth / 6)}px ${s.outlineColor}` : undefined,
                      textShadow: s.shadowBlur ? `0 2px 4px ${s.shadowColor}` : undefined,
                    }}
                  >
                    {p.content.split('\n')[0]}
                  </span>
                </div>
                <div className="truncate px-0.5 text-[11px] text-fg">{p.name}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
