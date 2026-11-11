import type { LayerGeometry } from './compositor';

// ---------------------------------------------------------------------------
// What the preview drew last: canvas size and where every clip landed.
// Published by PreviewPlayer after each render; read by the transform handles
// (and hit-testing) so they always match the actual pixels.
// ---------------------------------------------------------------------------

type Listener = () => void;

class PreviewSurface {
  width = 0;
  height = 0;
  /** Clip id → geometry, bottom-most first (Map insertion order). */
  geometries = new Map<string, LayerGeometry>();
  /** 'webgl2' or '2d' (fallback: no grading, effects or shader transitions). */
  backend: 'webgl2' | '2d' = 'webgl2';
  /** Live GPU resources after the last frame (diagnostics / leak checks). */
  gpuStats: { textures: number; framebuffers: number } | null = null;
  private listeners = new Set<Listener>();

  publish(width: number, height: number, geometries: Map<string, LayerGeometry>) {
    this.width = width;
    this.height = height;
    this.geometries = new Map(geometries);
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const previewSurface = new PreviewSurface();
