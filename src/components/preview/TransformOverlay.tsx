import { useEffect, useRef, useState } from 'react';
import { previewEngine } from '../../engine/previewEngine';
import { previewSurface } from '../../engine/previewSurface';
import { boxToCanvas, canvasToBox, type LayerGeometry } from '../../engine/compositor';
import { animatedValue } from '../../engine/animation';
import { resolvedDirection } from '../../engine/textRenderer';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { localPlayhead, setAnimatedValues, updateTextContent } from '../../services/advancedEditing';
import { selectClips } from '../../services/editingService';

// ---------------------------------------------------------------------------
// Direct manipulation on the preview: click a layer to select it, drag to
// move, corner handles to scale, the top knob to rotate (Shift: 15° steps),
// double-click text to edit it in place. All changes go through the same
// commands as the properties panel (keyframed properties get a keyframe at
// the playhead) and are one undo step per gesture.
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;

function hitTest(x: number, y: number): string | null {
  const entries = [...previewSurface.geometries.entries()].reverse(); // top-most first
  for (const [id, g] of entries) {
    const { u, v } = canvasToBox(g, x, y);
    const c = g.crop;
    if (u >= c.left && u <= 1 - c.right && v >= c.top && v <= 1 - c.bottom) return id;
  }
  return null;
}

const geoKey = (g: LayerGeometry | undefined) =>
  g ? [g.origin.x, g.origin.y, g.boxW, g.boxH, g.rotation, g.anchorX, g.anchorY, g.crop.left, g.crop.top, g.crop.right, g.crop.bottom].map((n) => n.toFixed(2)).join(',') : '';

export function TransformOverlay({ displayWidth, displayHeight }: { displayWidth: number; displayHeight: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = useUiStore((s) => s.previewMode);
  const selectedId = useUiStore((s) => (s.selection.kind === 'clips' && s.selection.ids.length === 1 ? s.selection.ids[0] : null));
  const clip = useProjectStore((s) => (selectedId ? s.document.clips[selectedId] : undefined));
  const locked = useProjectStore((s) => (clip ? !!s.document.tracks.find((t) => t.id === clip.trackId)?.locked : false));
  const [geo, setGeo] = useState<LayerGeometry | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Follow the rendered geometry of the selected clip (re-render only when it changes).
  useEffect(() => {
    let last = '';
    const update = () => {
      const g = selectedId ? previewSurface.geometries.get(selectedId) : undefined;
      const k = geoKey(g);
      if (k !== last) {
        last = k;
        setGeo(g);
      }
    };
    update();
    return previewSurface.subscribe(update);
  }, [selectedId]);

  useEffect(() => setEditing(false), [selectedId]);

  const W = previewSurface.width || 1;
  const H = previewSurface.height || 1;
  const k = displayWidth / W;

  /** Pointer position in canvas pixels. */
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  /** Generic drag: calls onMove with the pointer in canvas pixels; returns whether it moved. */
  const drag = (e: React.PointerEvent, onMove: (p: { x: number; y: number }, ev: PointerEvent) => void, onClick?: () => void) => {
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const id = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      onMove(toCanvas(ev), ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) onClick?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const beginMove = (e: React.PointerEvent, clipId: string, toggleOnClick: boolean) => {
    const project = useProjectStore.getState();
    const c = project.document.clips[clipId];
    const trackLocked = c && project.document.tracks.find((t) => t.id === c.trackId)?.locked;
    if (!c || trackLocked) {
      drag(e, () => undefined, toggleOnClick ? () => previewEngine.toggle() : undefined);
      return;
    }
    const local = localPlayhead(c);
    const x0 = animatedValue(c, 'x', local);
    const y0 = animatedValue(c, 'y', local);
    const p0 = toCanvas(e);
    let started = false;
    drag(
      e,
      (p) => {
        // Pause once a real drag starts (a plain click still toggles playback).
        if (!started) {
          started = true;
          previewEngine.pause();
        }
        let x = x0 + (p.x - p0.x) / W;
        let y = y0 + (p.y - p0.y) / H;
        // Snap the anchor to the canvas centre lines.
        if (Math.abs(x * W) < SNAP_PX / k) x = 0;
        if (Math.abs(y * H) < SNAP_PX / k) y = 0;
        setAnimatedValues(clipId, { x, y }, `preview.move.${clipId}`);
      },
      toggleOnClick ? () => previewEngine.toggle() : undefined,
    );
  };

  const onRootPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    if (mode !== 'timeline') {
      drag(e, () => undefined, () => previewEngine.toggle());
      return;
    }
    const p = toCanvas(e);
    const hit = hitTest(p.x, p.y);
    if (!hit) {
      drag(e, () => undefined, () => previewEngine.toggle());
      return;
    }
    const alreadySelected = hit === selectedId;
    if (!alreadySelected) selectClips([hit]);
    // A click on the selected layer toggles playback – except text, where a
    // double-click opens the inline editor (its first click must not start playback).
    const isText = !!useProjectStore.getState().document.clips[hit]?.text;
    beginMove(e, hit, alreadySelected && !isText);
  };

  const beginScale = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!clip || !geo || locked) return;
    const local = localPlayhead(clip);
    const s0 = animatedValue(clip, 'scale', local);
    const p0 = toCanvas(e);
    const d0 = Math.max(1, Math.hypot(p0.x - geo.origin.x, p0.y - geo.origin.y));
    const origin = geo.origin;
    previewEngine.pause();
    drag(e, (p) => {
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      setAnimatedValues(clip.id, { scale: s0 * (d / d0) }, `preview.scale.${clip.id}`);
    });
  };

  const beginRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!clip || !geo || locked) return;
    const local = localPlayhead(clip);
    const r0 = animatedValue(clip, 'rotation', local);
    const origin = geo.origin;
    const p0 = toCanvas(e);
    const a0 = Math.atan2(p0.y - origin.y, p0.x - origin.x);
    previewEngine.pause();
    drag(e, (p, ev) => {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      let r = r0 + ((a - a0) * 180) / Math.PI;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      setAnimatedValues(clip.id, { rotation: r }, `preview.rotate.${clip.id}`);
    });
  };

  const startEditing = () => {
    if (!clip?.text || locked) return;
    previewEngine.pause();
    setDraft(clip.text.content);
    setEditing(true);
  };
  const commitEdit = () => {
    if (clip?.text && draft !== clip.text.content && draft.trim()) updateTextContent(clip.id, draft);
    setEditing(false);
  };

  const showBox = mode === 'timeline' && clip && geo;
  let poly = '';
  let corners: { x: number; y: number }[] = [];
  let knob = { x: 0, y: 0 };
  let topMid = { x: 0, y: 0 };
  if (showBox) {
    const c = geo.crop;
    corners = [
      boxToCanvas(geo, c.left, c.top),
      boxToCanvas(geo, 1 - c.right, c.top),
      boxToCanvas(geo, 1 - c.right, 1 - c.bottom),
      boxToCanvas(geo, c.left, 1 - c.bottom),
    ].map((p) => ({ x: p.x * k, y: p.y * k }));
    poly = corners.map((p) => `${p.x},${p.y}`).join(' ');
    topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const rad = (geo.rotation * Math.PI) / 180;
    knob = { x: topMid.x + Math.sin(rad) * 22, y: topMid.y - Math.cos(rad) * 22 };
  }

  // Inline editor: axis-aligned box over the text, scaled to the display.
  let editorStyle: React.CSSProperties = {};
  if (editing && clip?.text && geo) {
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const st = clip.text.style;
    editorStyle = {
      left: Math.max(0, Math.min(...xs)),
      top: Math.max(0, Math.min(...ys)),
      width: Math.max(120, Math.max(...xs) - Math.min(...xs)),
      minHeight: Math.max(40, Math.max(...ys) - Math.min(...ys)),
      fontFamily: `"${st.fontFamily}", "Segoe UI", Tahoma, sans-serif`,
      fontWeight: st.fontWeight,
      fontSize: Math.max(10, st.fontSize * (displayHeight / 1080) * clip.transform.scale),
      lineHeight: st.lineHeight,
      textAlign: st.align,
      color: st.color,
    };
  }

  return (
    <div
      ref={rootRef}
      data-testid="preview-overlay"
      className="absolute inset-0 touch-none"
      onPointerDown={onRootPointerDown}
      onDoubleClick={() => {
        if (clip?.text) startEditing();
      }}
    >
      {showBox && !editing && (
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={displayWidth} height={displayHeight}>
          <polygon points={poly} fill="none" stroke="white" strokeWidth={1.25} />
          <polygon points={poly} fill="none" stroke="#6c7cff" strokeWidth={1} strokeDasharray="4 3" />
          {!locked && (
            <>
              <line x1={topMid.x} y1={topMid.y} x2={knob.x} y2={knob.y} stroke="white" strokeWidth={1} />
              <circle
                data-handle="rotate"
                aria-label="Rotate"
                cx={knob.x}
                cy={knob.y}
                r={6}
                className="pointer-events-auto cursor-grab fill-accent stroke-white"
                strokeWidth={1.5}
                onPointerDown={beginRotate}
              />
              {corners.map((p, i) => (
                <rect
                  key={i}
                  data-handle={`scale-${i}`}
                  aria-label="Scale"
                  x={p.x - 5}
                  y={p.y - 5}
                  width={10}
                  height={10}
                  rx={2}
                  className="pointer-events-auto cursor-nwse-resize fill-white stroke-accent"
                  strokeWidth={1.5}
                  onPointerDown={beginScale}
                />
              ))}
            </>
          )}
        </svg>
      )}
      {editing && clip?.text && (
        <textarea
          autoFocus
          aria-label="Edit text"
          dir={resolvedDirection({ ...clip.text, content: draft })}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitEdit();
            }
          }}
          className="absolute z-10 resize-none rounded border border-accent bg-black/70 p-1 outline-none"
          style={editorStyle}
        />
      )}
    </div>
  );
}
