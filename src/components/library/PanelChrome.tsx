import type { ReactNode } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';

export function PanelHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
      <h2 className="text-[12px] font-semibold">
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal text-fg-subtle">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function PanelHint({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-2.5 text-[11px] leading-relaxed text-fg-subtle">{children}</p>;
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{children}</div>;
}

/** Ids of the selected clips that still exist. */
export function useSelectedClipIds(): string[] {
  const selection = useUiStore((s) => s.selection);
  const clips = useProjectStore((s) => s.document.clips);
  return selection.kind === 'clips' ? selection.ids.filter((id) => clips[id]) : [];
}
