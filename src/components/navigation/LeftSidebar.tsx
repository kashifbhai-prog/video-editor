import {
  Captions,
  Clapperboard,
  Music2,
  Smile,
  SlidersHorizontal,
  Sparkles,
  Type,
  ArrowRightLeft,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import type { SidebarSection } from '../../types';
import { Tooltip } from '../controls/Tooltip';
import { cn } from '../../utils/cn';

export const SIDEBAR_SECTIONS: { id: SidebarSection; label: string; icon: LucideIcon }[] = [
  { id: 'media', label: 'Media', icon: Clapperboard },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'stickers', label: 'Stickers', icon: Smile },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'transitions', label: 'Transitions', icon: ArrowRightLeft },
  { id: 'filters', label: 'Filters', icon: SlidersHorizontal },
  { id: 'captions', label: 'Captions', icon: Captions },
];

export function LeftSidebar() {
  const active = useUiStore((s) => s.activeSection);
  const open = useUiStore((s) => s.libraryOpen);
  const select = useUiStore((s) => s.selectSection);

  return (
    <nav
      aria-label="Editing tools"
      className="scroll-thin flex w-[60px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-panel py-2"
    >
      {SIDEBAR_SECTIONS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id && open;
        return (
          <Tooltip key={id} label={isActive ? `Hide ${label}` : label} side="right">
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() => select(id)}
              className={cn(
                'relative flex w-[52px] flex-col items-center gap-1 rounded-md py-2 text-[10px] transition-colors',
                isActive ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              {isActive && <span className="absolute -left-1 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
              <Icon size={18} strokeWidth={1.75} />
              {label}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
