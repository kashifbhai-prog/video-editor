import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Clapperboard, Film, Upload } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useMediaStore } from '../../store/mediaStore';
import { useProjectStore } from '../../store/projectStore';
import { previewEngine } from '../../engine/previewEngine';
import { layerGeometry, renderFrame2D, type CompositorFrame, type LayerGeometry } from '../../engine/compositor';
import { GLRenderer } from '../../engine/gl/glRenderer';
import { previewSurface } from '../../engine/previewSurface';
import { setTextInvalidateListener } from '../../engine/textRenderer';
import { TransformOverlay } from './TransformOverlay';
import { useElementSize } from '../../hooks/useElementSize';
import { aspectToNumber, fitRect, getCanvasSize } from '../../utils/canvas';
import { PREVIEW_STAGE_ID } from '../../utils/fullscreen';
import { openFilePicker } from '../../utils/filePicker';
import { cn } from '../../utils/cn';
import type { PreviewQuality } from '../../types';
import { PreviewControls } from './PreviewControls';

const QUALITY_FACTOR: Record<PreviewQuality, number> = { full: 1, half: 0.5, quarter: 0.25 };

/** One WebGL2 context for the app's lifetime (null = unavailable → 2D fallback). */
let glRenderer: GLRenderer | null | undefined;
function getRenderer(): GLRenderer | null {
  if (glRenderer === undefined) {
    glRenderer = GLRenderer.create();
    if (!glRenderer) {
      previewSurface.backend = '2d';
      useUiStore
        .getState()
        .notify('WebGL2 is unavailable: the preview falls back to basic rendering (no colour grading, effects or shader transitions).', 'warning');
    }
  }
  return glRenderer;
}

function ModeTabs() {
  const mode = useUiStore((s) => s.previewMode);
  const previewId = useUiStore((s) => s.previewMediaId);
  const source = useMediaStore((s) => s.items.find((m) => m.id === previewId));
  const showTimeline = useUiStore((s) => s.showTimeline);
  const setPreviewMedia = useUiStore((s) => s.setPreviewMedia);
  const tab = (active: boolean) =>
    cn(
      'flex h-6 max-w-[220px] items-center gap-1.5 rounded px-2 text-[11px] transition-colors',
      active ? 'bg-panel-3 text-fg' : 'text-fg-muted hover:text-fg',
    );
  return (
    <div className="flex min-w-0 items-center gap-1" role="tablist" aria-label="Preview source">
      <button type="button" role="tab" aria-selected={mode === 'timeline'} className={tab(mode === 'timeline')} onClick={showTimeline}>
        <Clapperboard size={12} />
        Timeline
      </button>
      {source && (
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'source'}
          title={`Preview ${source.name}`}
          className={tab(mode === 'source')}
          onClick={() => setPreviewMedia(source.id)}
        >
          <Film size={12} className="shrink-0" />
          <span className="truncate">Source: {source.name}</span>
        </button>
      )}
    </div>
  );
}

export function PreviewPlayer() {
  const quality = useUiStore((s) => s.previewQuality);
  const mode = useUiStore((s) => s.previewMode);
  const hasMedia = useMediaStore((s) => s.items.length > 0);
  const hasClips = useProjectStore((s) => Object.keys(s.document.clips).length > 0);
  const importFiles = useMediaStore((s) => s.importFiles);
  const canvasSettings = useProjectStore((s) => s.document.canvas);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stage = useElementSize(stageRef);
  const ratio = aspectToNumber(canvasSettings.aspectRatio);
  const display = fitRect(stage.width - 32, stage.height - 32, ratio);

  const pixelSize = useMemo(() => {
    const base = getCanvasSize(canvasSettings.aspectRatio, canvasSettings.resolution);
    const f = QUALITY_FACTOR[quality];
    return { width: Math.max(2, Math.round(base.width * f)), height: Math.max(2, Math.round(base.height * f)) };
  }, [canvasSettings.aspectRatio, canvasSettings.resolution, quality]);

  // Latest render inputs in a ref so the frame callback stays stable.
  const renderInputs = useRef({ background: canvasSettings.backgroundColor, pixelSize });
  renderInputs.current = { background: canvasSettings.backgroundColor, pixelSize };

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { background, pixelSize: px } = renderInputs.current;
    const frame: CompositorFrame = { width: px.width, height: px.height, background, layers: previewEngine.getLayers() };
    const audioVisual = frame.layers.some((l) => l.kind === 'audio');
    const gl = audioVisual ? null : getRenderer();
    if (gl && gl.render(frame)) {
      // The GPU frame is copied onto the visible 2D canvas (one GPU blit).
      ctx.drawImage(gl.canvas, 0, 0);
      previewSurface.gpuStats = gl.stats;
      previewSurface.publish(px.width, px.height, gl.geometries);
      return;
    }
    renderFrame2D(ctx, frame);
    const geos = new Map<string, LayerGeometry>();
    for (const l of frame.layers) {
      const visuals = l.kind === 'visual' ? [l] : l.kind === 'transition' ? [l.from, l.to] : [];
      for (const v of visuals) if (v) geos.set(v.clipId, layerGeometry(v, px.width, px.height));
    }
    previewSurface.publish(px.width, px.height, geos);
  }, []);

  // The engine emits a frame on every clock tick, seek and decoded frame.
  useEffect(() => previewEngine.onFrame(draw), [draw]);
  // Web fonts used by text clips arrive asynchronously: re-render when they do.
  useEffect(() => {
    setTextInvalidateListener(() => previewEngine.emitFrame());
    return () => setTextInvalidateListener(null);
  }, []);
  // Canvas settings changes redraw (resizing the canvas clears it).
  useEffect(draw, [draw, canvasSettings.backgroundColor, pixelSize, display.width, display.height]);

  const emptyTimeline = mode === 'timeline' && !hasClips;

  return (
    <section id={PREVIEW_STAGE_ID} aria-label="Preview" className="flex h-full min-w-0 flex-1 basis-0 flex-col bg-app">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3">
        <h2 className="text-[12px] font-semibold">Player</h2>
        <ModeTabs />
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
          style={{ width: display.width, height: display.height }}
        >
          <canvas ref={canvasRef} width={pixelSize.width} height={pixelSize.height} className="block h-full w-full" />
          {hasMedia || hasClips ? <TransformOverlay displayWidth={display.width} displayHeight={display.height} /> : null}
          {!hasMedia && !hasClips && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-[12px] text-white/50">Import media to start editing</p>
              <button
                type="button"
                onClick={() => openFilePicker().then(importFiles)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 text-[12px] text-white/80 hover:bg-white/10"
              >
                <Upload size={13} />
                Import media
              </button>
            </div>
          )}
          {hasMedia && emptyTimeline && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
              <p className="max-w-[300px] text-[12px] leading-relaxed text-white/50">
                The timeline is empty. Drag media onto a track, or hover a media item and click <b>+</b>.
              </p>
            </div>
          )}
        </div>
      </div>

      <PreviewControls />
    </section>
  );
}
