import type { EffectType, TransitionType } from '../../types';
import { layerGeometry, type CompositorFrame, type LayerGeometry, type VisualLayer } from '../compositor';
import { getTextBitmap, TEXT_REFERENCE_HEIGHT } from '../textRenderer';
import { FS_BLUR, FS_EFFECT, FS_GLOW, FS_GRADE, FS_LAYER, FS_TRANSITION, VS_FULL, VS_LAYER } from './shaders';

// ---------------------------------------------------------------------------
// WebGL2 compositor. Per visual layer:
//   source texture (video frame / image / text bitmap)
//     → [grade pass] → [effect passes, ping-ponged through pooled FBOs]
//     → transformed quad on the canvas (position, scale, rotation, anchor,
//       flip, crop, opacity), premultiplied-alpha "over" blending.
// Transitions render both clips to canvas-sized FBOs and mix them in a shader.
//
// Resources: textures are cached per source object and freed when unused for
// a while; FBOs come from a size-keyed pool. Everything is released on
// dispose() and rebuilt after a context loss.
// ---------------------------------------------------------------------------

interface Program {
  prog: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

interface TexEntry {
  tex: WebGLTexture;
  lastUsed: number;
  /** Frame number the texture was last uploaded on (video: once per frame). */
  uploadedAt: number;
}

interface Fbo {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
  inUse: boolean;
  lastUsed: number;
}

const EFFECT_CODE: Partial<Record<EffectType, number>> = {
  vignette: 1,
  sharpen: 2,
  noise: 3,
  filmGrain: 4,
  pixelate: 5,
  glitch: 6,
  rgbSplit: 7,
  chromaticAberration: 8,
  motionBlur: 9,
};

const TRANSITION_CODE: Record<TransitionType, number> = {
  fade: 0,
  dissolve: 1,
  crossfade: 2,
  wipeLeft: 3,
  wipeRight: 4,
  wipeUp: 5,
  wipeDown: 6,
  zoomIn: 7,
  zoomOut: 8,
  slideLeft: 9,
  slideRight: 10,
  blur: 11,
};

/** Unused textures / FBOs are deleted after this many frames. */
const EVICT_AFTER_FRAMES = 90;

function parseColor(css: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Raster scale for text, quantised to quarter-octaves so animated scale reuses bitmaps. */
const quantiseScale = (s: number) => 2 ** (Math.ceil(Math.log2(Math.max(0.05, s)) * 4) / 4);

export class GLRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private lost = false;
  private progLayer!: Program;
  private progGrade!: Program;
  private progBlur!: Program;
  private progGlow!: Program;
  private progEffect!: Program;
  private progTransition!: Program;
  private vao!: WebGLVertexArrayObject;
  private quad!: WebGLBuffer;
  private textures = new Map<object | string, TexEntry>();
  private fbos: Fbo[] = [];
  private frameNo = 0;
  private W = 0;
  private H = 0;
  /** Where each clip was drawn in the last frame (canvas pixels) – for the transform handles. */
  readonly geometries = new Map<string, LayerGeometry>();

  /** Returns null when WebGL2 is unavailable. `preserveDrawingBuffer`: needed when the canvas is captured (export). */
  static create(opts: { preserveDrawingBuffer?: boolean } = {}): GLRenderer | null {
    try {
      const r = new GLRenderer(!!opts.preserveDrawingBuffer);
      return r.gl ? r : null;
    } catch {
      return null;
    }
  }

  private constructor(private readonly preserve = false) {
    this.canvas = document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.textures.clear();
      this.fbos = [];
      this.init();
      this.lost = false;
    });
    this.init();
  }

  get isLost() {
    return this.lost;
  }

  private init() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: this.preserve });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.progLayer = this.program(VS_LAYER, FS_LAYER);
    this.progGrade = this.program(VS_FULL, FS_GRADE);
    this.progBlur = this.program(VS_FULL, FS_BLUR);
    this.progGlow = this.program(VS_FULL, FS_GLOW);
    this.progEffect = this.program(VS_FULL, FS_EFFECT);
    this.progTransition = this.program(VS_FULL, FS_TRANSITION);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      prog,
      u: (name) => {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
        return cache.get(name)!;
      },
    };
  }

  // ---- Frame -----------------------------------------------------------------------

  /** Renders a frame into `this.canvas`. Returns false if the context is lost. */
  render(frame: CompositorFrame): boolean {
    if (this.lost) return false;
    const gl = this.gl;
    this.frameNo++;
    const { width: W, height: H } = frame;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.W = W;
    this.H = H;
    this.geometries.clear();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const [r, g, b] = parseColor(frame.background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    for (const layer of frame.layers) {
      if (layer.kind === 'visual') this.drawLayer(layer, null);
      else if (layer.kind === 'transition') this.drawTransition(layer.type, layer.progress, layer.from, layer.to);
    }
    this.evict();
    return true;
  }

  private bindTarget(target: Fbo | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.W, target ? target.h : this.H);
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // ---- Layers ---------------------------------------------------------------------

  /** Draws one visual layer onto `target` (null = the canvas). */
  private drawLayer(layer: VisualLayer, target: Fbo | null) {
    const gl = this.gl;
    const { W, H } = this;
    const geo = layerGeometry(layer, W, H);
    this.geometries.set(layer.clipId, geo);
    if (layer.t.opacity <= 0 || geo.boxW < 0.5 || geo.boxH < 0.5) return;

    let tex: WebGLTexture;
    let sw: number;
    let sh: number;
    if (layer.content.type === 'text') {
      const rasterScale = quantiseScale((H / TEXT_REFERENCE_HEIGHT) * layer.t.scale);
      const bmp = getTextBitmap(layer.content.text, layer.content.visibleChars, rasterScale);
      tex = this.textureFor(bmp.canvas, bmp.canvas, false);
      sw = bmp.canvas.width;
      sh = bmp.canvas.height;
    } else {
      const c = layer.content;
      // A video held mid-seek reuses its last uploaded frame; with none yet there is nothing to draw.
      const isHeldVideo = !c.dynamic && c.source instanceof HTMLVideoElement;
      if (isHeldVideo && !this.textures.has(c.source)) return;
      tex = this.textureFor(c.key ?? c.source, c.source, c.dynamic);
      sw = c.width;
      sh = c.height;
    }

    const temps: Fbo[] = [];
    if (layer.grade || layer.effects.length) {
      tex = this.process(layer, tex, sw, sh, geo, temps);
    }

    this.bindTarget(target);
    const p = this.progLayer;
    gl.useProgram(p.prog);
    const rad = (geo.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tw = target ? target.w : W;
    const th = target ? target.h : H;
    gl.uniform2f(p.u('uCanvas'), tw, th);
    gl.uniform2f(p.u('uOrigin'), geo.origin.x, geo.origin.y);
    gl.uniform2f(p.u('uAxisU'), cos * geo.boxW, sin * geo.boxW);
    gl.uniform2f(p.u('uAxisV'), -sin * geo.boxH, cos * geo.boxH);
    gl.uniform2f(p.u('uAnchor'), geo.anchorX, geo.anchorY);
    const c = geo.crop;
    gl.uniform4f(p.u('uCrop'), c.left, c.top, 1 - c.right, 1 - c.bottom);
    gl.uniform2f(p.u('uFlip'), layer.t.flipH ? 1 : 0, layer.t.flipV ? 1 : 0);
    gl.uniform1f(p.u('uOpacity'), layer.t.opacity);
    gl.uniform1i(p.u('uTex'), 0);
    this.bindTex(0, tex);
    gl.enable(gl.BLEND);
    this.drawQuad();
    temps.forEach((f) => (f.inUse = false));
  }

  /** Grade + effects at the size the layer is drawn (never above the source size). */
  private process(layer: VisualLayer, src: WebGLTexture, sw: number, sh: number, geo: LayerGeometry, temps: Fbo[]): WebGLTexture {
    const gl = this.gl;
    const pw = Math.max(16, Math.round(Math.min(sw, geo.boxW)));
    const ph = Math.max(16, Math.round(Math.min(sh, geo.boxH)));
    /** Reference pixels (1080p canvas) → processing pixels. */
    const refToProc = (this.H / TEXT_REFERENCE_HEIGHT) * (ph / geo.boxH);
    const acquire = () => {
      const f = this.acquireFbo(pw, ph);
      temps.push(f);
      return f;
    };
    gl.disable(gl.BLEND);

    // 1. Grade (always runs: it also resamples the source to the processing size).
    let cur = acquire();
    this.bindTarget(cur);
    const g = this.progGrade;
    gl.useProgram(g.prog);
    const adj = layer.grade?.adjust;
    gl.uniform1i(g.u('uTex'), 0);
    gl.uniform2f(g.u('uTexel'), 1 / sw, 1 / sh);
    gl.uniform1f(g.u('uBrightness'), adj?.brightness ?? 0);
    gl.uniform1f(g.u('uContrast'), adj?.contrast ?? 0);
    gl.uniform1f(g.u('uSaturation'), adj?.saturation ?? 0);
    gl.uniform1f(g.u('uExposure'), adj?.exposure ?? 0);
    gl.uniform1f(g.u('uTemperature'), adj?.temperature ?? 0);
    gl.uniform1f(g.u('uTint'), adj?.tint ?? 0);
    gl.uniform1f(g.u('uHighlights'), adj?.highlights ?? 0);
    gl.uniform1f(g.u('uShadows'), adj?.shadows ?? 0);
    gl.uniform1f(g.u('uSharpness'), adj?.sharpness ?? 0);
    gl.uniform1f(g.u('uFade'), adj?.fade ?? 0);
    gl.uniform1f(g.u('uVignette'), adj?.vignette ?? 0);
    gl.uniform3fv(g.u('uShadowTint'), layer.grade?.shadowTint ?? [0, 0, 0]);
    gl.uniform3fv(g.u('uHighlightTint'), layer.grade?.highlightTint ?? [0, 0, 0]);
    this.bindTex(0, src);
    this.drawQuad();

    // 2. Effects, in order.
    for (const fx of layer.effects) {
      const amt = fx.intensity;
      if (amt <= 0) continue;
      if (fx.type === 'blur' || fx.type === 'gaussianBlur') {
        const radius = amt * (fx.type === 'blur' ? 24 : 48) * refToProc;
        cur = this.blur2(cur, radius, fx.type === 'gaussianBlur', acquire);
      } else if (fx.type === 'glow') {
        const blurred = this.blur2(cur, 22 * refToProc, true, acquire);
        const out = acquire();
        this.bindTarget(out);
        const p = this.progGlow;
        gl.useProgram(p.prog);
        gl.uniform1i(p.u('uTex'), 0);
        gl.uniform1i(p.u('uBlur'), 1);
        gl.uniform1f(p.u('uAmount'), amt);
        this.bindTex(0, cur.tex);
        this.bindTex(1, blurred.tex);
        this.drawQuad();
        cur = out;
      } else {
        const out = acquire();
        this.bindTarget(out);
        const p = this.progEffect;
        gl.useProgram(p.prog);
        gl.uniform1i(p.u('uTex'), 0);
        gl.uniform1i(p.u('uType'), EFFECT_CODE[fx.type] ?? 0);
        gl.uniform1f(p.u('uAmount'), amt);
        gl.uniform2f(p.u('uTexel'), 1 / pw, 1 / ph);
        gl.uniform2f(p.u('uSize'), pw, ph);
        gl.uniform1f(p.u('uTime'), layer.time);
        const param = fx.type === 'pixelate' ? [(2 + amt * 46) * refToProc, 0] : fx.type === 'motionBlur' ? this.motionDir(layer, geo, amt) : [0, 0];
        gl.uniform2f(p.u('uParam'), param[0], param[1]);
        this.bindTex(0, cur.tex);
        this.drawQuad();
        cur = out;
      }
    }
    gl.enable(gl.BLEND);
    return cur.tex;
  }

  /** Two-pass separable blur; returns the output FBO. */
  private blur2(input: Fbo, radiusPx: number, gauss: boolean, acquire: () => Fbo): Fbo {
    const gl = this.gl;
    const p = this.progBlur;
    gl.useProgram(p.prog);
    gl.uniform1i(p.u('uTex'), 0);
    gl.uniform1f(p.u('uGauss'), gauss ? 1 : 0);
    const step = radiusPx / 6;
    const h = acquire();
    this.bindTarget(h);
    gl.uniform2f(p.u('uStep'), step / input.w, 0);
    this.bindTex(0, input.tex);
    this.drawQuad();
    const v = acquire();
    this.bindTarget(v);
    gl.uniform2f(p.u('uStep'), 0, step / input.h);
    this.bindTex(0, h.tex);
    this.drawQuad();
    return v;
  }

  /**
   * Motion blur streak in texture space: the anchor's on-canvas velocity over
   * a shutter of (0.5 … 2) frames, rotated into the layer's frame. A static
   * clip gets a fixed horizontal streak proportional to the intensity.
   */
  private motionDir(layer: VisualLayer, geo: LayerGeometry, amt: number): [number, number] {
    const { W, H } = this;
    const vx = layer.velocity.x * W;
    const vy = layer.velocity.y * H;
    const shutter = (0.5 + 1.5 * amt) / Math.max(1, layer.fps);
    let dx = vx * shutter;
    let dy = vy * shutter;
    if (Math.hypot(dx, dy) < 0.5) {
      dx = amt * 40 * (H / TEXT_REFERENCE_HEIGHT);
      dy = 0;
    }
    const rad = (-geo.rotation * Math.PI) / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return [lx / geo.boxW, -ly / geo.boxH];
  }

  private drawTransition(type: TransitionType, progress: number, from: VisualLayer | null, to: VisualLayer | null) {
    const gl = this.gl;
    const { W, H } = this;
    const fa = this.acquireFbo(W, H);
    const fb = this.acquireFbo(W, H);
    for (const [fbo, layer] of [
      [fa, from],
      [fb, to],
    ] as const) {
      this.bindTarget(fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (layer) this.drawLayer(layer, fbo);
    }
    this.bindTarget(null);
    const p = this.progTransition;
    gl.useProgram(p.prog);
    gl.uniform1i(p.u('uFrom'), 0);
    gl.uniform1i(p.u('uTo'), 1);
    gl.uniform1f(p.u('uP'), progress);
    gl.uniform1i(p.u('uType'), TRANSITION_CODE[type]);
    gl.uniform2f(p.u('uSize'), W, H);
    gl.uniform1f(p.u('uBlurPx'), 24 * (H / TEXT_REFERENCE_HEIGHT));
    this.bindTex(0, fa.tex);
    this.bindTex(1, fb.tex);
    gl.enable(gl.BLEND);
    this.drawQuad();
    fa.inUse = false;
    fb.inUse = false;
  }

  // ---- Resources -------------------------------------------------------------------

  private textureFor(key: object | string, source: TexImageSource, dynamic: boolean): WebGLTexture {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (!e) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e = { tex, lastUsed: 0, uploadedAt: -1 };
      this.textures.set(key, e);
    }
    e.lastUsed = this.frameNo;
    // Video frames change: upload once per rendered frame. Stills: once.
    if (e.uploadedAt < 0 || (dynamic && e.uploadedAt !== this.frameNo)) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      e.uploadedAt = this.frameNo;
    }
    return e.tex;
  }

  private acquireFbo(w: number, h: number): Fbo {
    const gl = this.gl;
    let f = this.fbos.find((x) => !x.inUse && x.w === w && x.h === h);
    if (!f) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      f = { fb, tex, w, h, inUse: false, lastUsed: 0 };
      this.fbos.push(f);
    }
    f.inUse = true;
    f.lastUsed = this.frameNo;
    return f;
  }

  private evict() {
    const gl = this.gl;
    for (const [key, e] of this.textures) {
      if (this.frameNo - e.lastUsed > EVICT_AFTER_FRAMES) {
        gl.deleteTexture(e.tex);
        this.textures.delete(key);
      }
    }
    this.fbos = this.fbos.filter((f) => {
      if (f.inUse || this.frameNo - f.lastUsed <= EVICT_AFTER_FRAMES) return true;
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
      return false;
    });
  }

  /** Largest canvas dimension this GPU can render (texture / renderbuffer / viewport limits). */
  get maxDimension(): number {
    const gl = this.gl;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, vp[0], vp[1]);
  }

  /** Live GPU resources (for diagnostics / leak tests). */
  get stats() {
    return { textures: this.textures.size, framebuffers: this.fbos.length };
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.textures.forEach((e) => gl.deleteTexture(e.tex));
    this.fbos.forEach((f) => {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    });
    this.textures.clear();
    this.fbos = [];
    for (const p of [this.progLayer, this.progGrade, this.progBlur, this.progGlow, this.progEffect, this.progTransition]) gl.deleteProgram(p.prog);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
