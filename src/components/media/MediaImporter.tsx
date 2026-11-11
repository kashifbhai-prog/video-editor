import { useState, type DragEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useMediaStore } from '../../store/mediaStore';
import { openFilePicker } from '../../utils/filePicker';
import { cn } from '../../utils/cn';

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/** Wraps a region so that files dropped anywhere on it are imported. */
export function MediaDropTarget({
  children,
  className,
  accept,
}: {
  children: ReactNode;
  className?: string;
  accept?: string;
}) {
  const importFiles = useMediaStore((s) => s.importFiles);
  const [depth, setDepth] = useState(0);

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        setDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDepth(0);
        void importFiles(e.dataTransfer.files);
      }}
      data-accept={accept}
    >
      {children}
      {depth > 0 && (
        <div className="pointer-events-none absolute inset-1 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-accent/10 text-accent backdrop-blur-[1px]">
          <Upload size={22} />
          <span className="text-[12px] font-medium">Drop files to import</span>
        </div>
      )}
    </div>
  );
}

/** Large drop zone shown when the library is empty; compact strip otherwise. */
export function MediaImporter({ compact, accept, hint }: { compact?: boolean; accept?: string; hint?: string }) {
  const importFiles = useMediaStore((s) => s.importFiles);
  const pick = () => openFilePicker(accept).then(importFiles);

  if (compact) {
    return (
      <button
        type="button"
        onClick={pick}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-fg"
      >
        <Upload size={13} />
        Drop files here or click to browse
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={pick}
      className="group flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-panel-2/40 px-4 py-10 text-center transition-colors hover:border-accent hover:bg-accent/5"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform group-hover:scale-105">
        <Upload size={20} />
      </span>
      <span className="text-[13px] font-medium text-fg">Import media</span>
      <span className="max-w-[220px] text-[11px] leading-relaxed text-fg-subtle">
        {hint ?? 'Drag & drop video, image or audio files here, or click to browse.'}
      </span>
      <span className="text-[10px] text-fg-subtle">MP4 · WebM · MOV · PNG · JPG · GIF · MP3 · WAV · M4A</span>
    </button>
  );
}
