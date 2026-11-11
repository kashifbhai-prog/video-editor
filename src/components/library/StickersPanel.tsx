import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { BUILT_IN_STICKERS, stickerDataUrl, stickerFile, type BuiltInSticker } from '../../assets/stickers';
import { useMediaStore } from '../../store/mediaStore';
import { useUiStore } from '../../store/uiStore';
import { addOverlayAtPlayhead } from '../../services/advancedEditing';
import { openFilePicker } from '../../utils/filePicker';
import { MEDIA_DRAG_MIME, setDraggedMedia } from '../timeline/dragStore';
import { GroupLabel, PanelHeader, PanelHint } from './PanelChrome';

const IMAGE_ACCEPT = 'image/*,.png,.webp,.svg,.gif,.jpg,.jpeg,.avif';

/** Imports a built-in sticker once (reused afterwards) and places it at the playhead. */
async function placeBuiltIn(sticker: BuiltInSticker) {
  const media = useMediaStore.getState();
  const fileName = `sticker-${sticker.id}.svg`;
  let item = media.items.find((m) => m.name === fileName && m.status === 'ready');
  if (!item) {
    await media.importFiles([stickerFile(sticker)]);
    const matches = useMediaStore.getState().items.filter((m) => m.name === fileName && m.status === 'ready');
    item = matches[matches.length - 1];
  }
  if (!item) {
    useUiStore.getState().notify(`Could not load the "${sticker.name}" sticker.`, 'error');
    return;
  }
  addOverlayAtPlayhead(item);
}

export function StickersPanel() {
  const items = useMediaStore((s) => s.items);
  const images = useMemo(() => items.filter((m) => m.kind === 'image'), [items]);
  const importFiles = useMediaStore((s) => s.importFiles);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Stickers & overlays"
        action={
          <button
            type="button"
            onClick={() => openFilePicker(IMAGE_ACCEPT).then(importFiles)}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-white hover:bg-accent-hover"
          >
            <Upload size={12} strokeWidth={2.25} />
            Upload
          </button>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHint>
          Click to place at the playhead on an overlay track (PNG/SVG transparency is kept), or drag onto any visual track. Move, scale and
          rotate it directly in the player.
        </PanelHint>
        <GroupLabel>Built-in</GroupLabel>
        <div className="grid grid-cols-4 gap-1.5 px-3">
          {BUILT_IN_STICKERS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Add sticker ${s.name}`}
              title={s.name}
              disabled={busy === s.id}
              onClick={async () => {
                setBusy(s.id);
                try {
                  await placeBuiltIn(s);
                } finally {
                  setBusy(null);
                }
              }}
              className="flex aspect-square items-center justify-center rounded-md bg-[repeating-conic-gradient(#2a2b31_0_25%,#222328_0_50%)] bg-[length:14px_14px] p-1.5 transition-transform hover:scale-105 disabled:opacity-50"
            >
              <img src={stickerDataUrl(s)} alt="" draggable={false} className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
        <GroupLabel>Your images ({images.length})</GroupLabel>
        {images.length === 0 ? (
          <p className="px-3 text-[11px] text-fg-subtle">Upload PNG, WebP or SVG images to use them as stickers and overlays.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 px-3">
            {images.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-label={`Add overlay ${m.name}`}
                title={`${m.name}\nClick to place at the playhead, or drag onto a track`}
                disabled={m.status !== 'ready'}
                draggable={m.status === 'ready'}
                onDragStart={(e) => {
                  e.dataTransfer.setData(MEDIA_DRAG_MIME, m.id);
                  e.dataTransfer.effectAllowed = 'copy';
                  setDraggedMedia(m);
                }}
                onDragEnd={() => setDraggedMedia(null)}
                onClick={() => addOverlayAtPlayhead(m)}
                className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#2a2b31_0_25%,#222328_0_50%)] bg-[length:14px_14px] p-1 transition-transform hover:scale-105 disabled:opacity-40"
              >
                {m.thumbnail ? <img src={m.thumbnail} alt="" draggable={false} className="max-h-full max-w-full object-contain" /> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
