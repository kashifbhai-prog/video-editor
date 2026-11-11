import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { Tooltip } from '../controls/Tooltip';
import { InlineTextInput } from '../controls/InlineTextInput';

export function ProjectNameEditor() {
  const name = useProjectStore((s) => s.document.name);
  const setName = useProjectStore((s) => s.setName);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <InlineTextInput
        autoSelect
        value={name}
        maxLength={80}
        aria-label="Project name"
        onCommit={setName}
        onDone={() => setEditing(false)}
        className="field h-7! w-64 text-center text-[13px] font-medium"
      />
    );
  }

  return (
    <Tooltip label="Rename project">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex h-7 max-w-[320px] items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-fg hover:bg-hover"
      >
        <span className="truncate">{name}</span>
        <Pencil size={12} className="shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </Tooltip>
  );
}
