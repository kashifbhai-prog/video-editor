import { useCallback, useMemo } from 'react';
import { LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import type { MediaFilter, MediaItem, MediaKind } from '../../types';
import { openFilePicker } from '../../utils/filePicker';
import { cn } from '../../utils/cn';
import { IconButton } from '../controls/IconButton';
import { MediaDropTarget, MediaImporter } from './MediaImporter';
import { MediaItemView } from './MediaItemView';

const FILTERS: { id: MediaFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' },
];

interface MediaLibraryProps {
  /** Restricts the library to one media kind (used by the Audio section). */
  lockedKind?: MediaKind;
  title?: string;
  accept?: string;
  emptyHint?: string;
}

export function MediaLibrary({ lockedKind, title = 'Media', accept, emptyHint }: MediaLibraryProps) {
  const items = useMediaStore((s) => s.items);
  const importFiles = useMediaStore((s) => s.importFiles);
  const removeMedia = useMediaStore((s) => s.removeMedia);

  const filterState = useUiStore((s) => s.mediaFilter);
  const setFilter = useUiStore((s) => s.setMediaFilter);
  const search = useUiStore((s) => s.mediaSearch);
  const setSearch = useUiStore((s) => s.setMediaSearch);
  const viewMode = useUiStore((s) => s.mediaViewMode);
  const setViewMode = useUiStore((s) => s.setMediaViewMode);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const previewMediaId = useUiStore((s) => (s.previewMode === 'source' ? s.previewMediaId : null));
  const setPreviewMedia = useUiStore((s) => s.setPreviewMedia);

  const filter: MediaFilter = lockedKind ?? filterState;

  const counts = useMemo(() => {
    const c: Record<MediaFilter, number> = { all: items.length, video: 0, image: 0, audio: 0 };
    items.forEach((m) => c[m.kind]++);
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((m) => (filter === 'all' || m.kind === filter) && (!q || m.name.toLowerCase().includes(q)));
  }, [items, filter, search]);

  const onSelect = useCallback(
    (item: MediaItem) => {
      setSelection({ kind: 'media', id: item.id });
      if (item.status === 'ready') setPreviewMedia(item.id);
    },
    [setSelection, setPreviewMedia],
  );
  const onRemove = useCallback((item: MediaItem) => removeMedia(item.id), [removeMedia]);

  const scopedCount = lockedKind ? counts[lockedKind] : counts.all;

  return (
    <MediaDropTarget className="flex h-full min-h-0 flex-col" accept={accept}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[12px] font-semibold">
          {title}
          <span className="ml-1.5 font-normal text-fg-subtle">{scopedCount}</span>
        </h2>
        <button
          type="button"
          onClick={() => openFilePicker(accept).then(importFiles)}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-white hover:bg-accent-hover"
        >
          <Plus size={13} strokeWidth={2.25} />
          Import
        </button>
      </div>

      {/* Search + view */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            placeholder="Search media"
            aria-label="Search media"
            onChange={(e) => setSearch(e.target.value)}
            className="field pl-7! pr-6"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex rounded-md border border-line-strong p-px">
          <IconButton
            icon={LayoutGrid}
            size="sm"
            label="Grid view"
            active={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          />
          <IconButton
            icon={List}
            size="sm"
            label="List view"
            active={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          />
        </div>
      </div>

      {/* Categories */}
      {!lockedKind && (
        <div className="flex shrink-0 gap-1 px-3 pt-2" role="tablist" aria-label="Media categories">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'h-6 rounded-full px-2.5 text-[11px] transition-colors',
                filter === f.id ? 'bg-fg text-app' : 'bg-panel-2 text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              {f.label}
              <span className={cn('ml-1', filter === f.id ? 'text-app/60' : 'text-fg-subtle')}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
        {scopedCount === 0 ? (
          <MediaImporter accept={accept} hint={emptyHint} />
        ) : (
          <>
            <MediaImporter compact accept={accept} />
            {visible.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-fg-subtle">No media matches your search.</p>
            ) : (
              <div className={cn('mt-2.5', viewMode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2 gap-y-2.5' : 'flex flex-col gap-0.5')}>
                {visible.map((item) => (
                  <MediaItemView
                    key={item.id}
                    item={item}
                    mode={viewMode}
                    selected={selection.kind === 'media' && selection.id === item.id}
                    previewing={previewMediaId === item.id}
                    onSelect={onSelect}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </MediaDropTarget>
  );
}
