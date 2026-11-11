// ---------------------------------------------------------------------------
// GLSL ES 3.0 shaders. All colours are PREMULTIPLIED alpha; textures are
// uploaded with FLIP_Y so (0,0) is the bottom-left of every image and FBO.
// ---------------------------------------------------------------------------

/** Full-screen pass: vUv covers 0..1 of the target. */
export const VS_FULL = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Places a (cropped) layer box on the canvas. Box space: u right, v down, 0..1;
 * canvas space: pixels, y down. Flips mirror the texture inside the box.
 */
export const VS_LAYER = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uCanvas;
uniform vec2 uOrigin;
uniform vec2 uAxisU;
uniform vec2 uAxisV;
uniform vec2 uAnchor;
uniform vec4 uCrop;   // minU, minV, maxU, maxV
uniform vec2 uFlip;   // 1 = flipped
out vec2 vUv;
void main() {
  vec2 box = mix(uCrop.xy, uCrop.zw, aPos);
  vec2 px = uOrigin + (box.x - uAnchor.x) * uAxisU + (box.y - uAnchor.y) * uAxisV;
  vec2 tex = vec2(box.x, 1.0 - box.y);
  if (uFlip.x > 0.5) tex.x = 1.0 - tex.x;
  if (uFlip.y > 0.5) tex.y = 1.0 - tex.y;
  vUv = tex;
  gl_Position = vec4(px.x / uCanvas.x * 2.0 - 1.0, 1.0 - px.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

export const FS_LAYER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 o;
void main() {
  o = texture(uTex, vUv) * uOpacity;
}`;

const COMMON = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
`;

/** Colour grade: adjustments + split toning (filters) + sharpness, in one pass. */
export const FS_GRADE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uBrightness, uContrast, uSaturation, uExposure, uTemperature, uTint;
uniform float uHighlights, uShadows, uSharpness, uFade, uVignette;
uniform vec3 uShadowTint, uHighlightTint;
out vec4 o;
${COMMON}
void main() {
  vec4 s = texture(uTex, vUv);
  if (uSharpness > 0.0) {
    vec4 n = texture(uTex, vUv + vec2(uTexel.x, 0.0)) + texture(uTex, vUv - vec2(uTexel.x, 0.0))
           + texture(uTex, vUv + vec2(0.0, uTexel.y)) + texture(uTex, vUv - vec2(0.0, uTexel.y));
    s = clamp(s + (s - n * 0.25) * uSharpness * 2.5, 0.0, 1.0);
  }
  float a = s.a;
  if (a <= 0.0) { o = vec4(0.0); return; }
  vec3 c = s.rgb / a;
  c *= exp2(uExposure * 1.5);
  // Brightness: lift towards white / scale towards black (keeps hue on saturated colours).
  c = uBrightness >= 0.0 ? c + (1.0 - c) * uBrightness * 0.6 : c * (1.0 + uBrightness * 0.8);
  c = (c - 0.5) * (1.0 + uContrast * (uContrast > 0.0 ? 0.9 : 0.75)) + 0.5;
  c.r += uTemperature * 0.2;
  c.g += uTemperature * 0.03;
  c.b -= uTemperature * 0.2;
  c.g -= uTint * 0.15;
  c.rb += uTint * 0.05;
  float l = dot(clamp(c, 0.0, 1.0), LUMA);
  float sh = 1.0 - smoothstep(0.0, 0.55, l);
  float hi = smoothstep(0.45, 1.0, l);
  c += uShadows * 0.3 * sh;
  c += uHighlights * 0.3 * hi;
  c += uShadowTint * sh + uHighlightTint * hi;
  l = dot(c, LUMA);
  c = mix(vec3(l), c, 1.0 + uSaturation);
  c = c * (1.0 - uFade * 0.3) + uFade * 0.12;
  if (uVignette > 0.0) {
    float r = length(vUv - 0.5) * 1.4142;
    c *= 1.0 - uVignette * 0.85 * smoothstep(0.3, 1.0, r);
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * a, a);
}`;

/** Separable blur pass (13 taps). uGauss = 1: gaussian weights, 0: box. */
export const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uGauss;
out vec4 o;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float w = uGauss > 0.5 ? exp(-x * x / 18.0) : 1.0;
    acc += texture(uTex, vUv + uStep * x) * w;
    wsum += w;
  }
  o = acc / wsum;
}`;

/** Glow: adds the bright part of a blurred copy back onto the image. */
export const FS_GLOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBlur;
uniform float uAmount;
out vec4 o;
void main() {
  vec4 b = texture(uTex, vUv);
  vec4 bl = texture(uBlur, vUv);
  vec3 bright = max(bl.rgb - vec3(0.4 * bl.a), 0.0) * uAmount * 3.0;
  vec3 c = min(b.rgb + bright, vec3(1.0));
  float a = max(b.a, max(c.r, max(c.g, c.b)));
  o = vec4(c, a);
}`;

/** Single-pass effects, selected by uType. */
export const FS_EFFECT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform int uType;
uniform float uAmount;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uParam;
out vec4 o;
${COMMON}
vec4 at(vec2 uv) { return texture(uTex, clamp(uv, 0.0, 1.0)); }
void main() {
  vec2 uv = vUv;
  vec4 c = texture(uTex, uv);
  if (uType == 1) {            // vignette
    float r = length(uv - 0.5) * 1.4142;
    c.rgb *= 1.0 - uAmount * smoothstep(0.25, 1.0, r);
  } else if (uType == 2) {     // sharpen
    vec4 n = (at(uv + vec2(uTexel.x, 0.0)) + at(uv - vec2(uTexel.x, 0.0)) + at(uv + vec2(0.0, uTexel.y)) + at(uv - vec2(0.0, uTexel.y))) * 0.25;
    c = clamp(c + (c - n) * uAmount * 3.0, 0.0, 1.0);
    c.rgb = min(c.rgb, vec3(c.a));
  } else if (uType == 3) {     // colour noise
    float t = floor(uTime * 24.0);
    vec2 p = floor(uv * uSize);
    vec3 n = vec3(hash(p + t), hash(p + t + 17.0), hash(p + t + 41.0)) - 0.5;
    c.rgb = clamp(c.rgb + n * uAmount * 0.6 * c.a, 0.0, c.a);
  } else if (uType == 4) {     // film grain (luminance, strongest in midtones)
    float t = floor(uTime * 24.0);
    float g = hash(floor(uv * uSize) + t * 7.13) - 0.5;
    float l = dot(c.rgb, LUMA) / max(c.a, 1e-4);
    float m = 1.0 - abs(l - 0.5) * 1.2;
    c.rgb = clamp(c.rgb + g * uAmount * 0.35 * m * c.a, 0.0, c.a);
  } else if (uType == 5) {     // pixelate (uParam.x = block size in pixels)
    vec2 block = vec2(max(1.0, uParam.x));
    vec2 px = (floor(uv * uSize / block) + 0.5) * block;
    c = at(px / uSize);
  } else if (uType == 6) {     // glitch
    float t = floor(uTime * 12.0);
    float band = floor(uv.y * 24.0);
    float shift = hash(vec2(band, t)) > 1.0 - 0.35 * uAmount ? (hash(vec2(t, band + 3.0)) - 0.5) * 0.2 * uAmount : 0.0;
    float band2 = floor(uv.y * 6.0);
    shift += hash(vec2(band2 + 11.0, t)) > 1.0 - 0.15 * uAmount ? (hash(vec2(t + 5.0, band2)) - 0.5) * 0.08 * uAmount : 0.0;
    vec2 u2 = vec2(uv.x + shift, uv.y);
    float ca = 0.006 * uAmount * (shift != 0.0 ? 3.0 : 1.0);
    vec4 cr = at(u2 + vec2(ca, 0.0));
    vec4 cg = at(u2);
    vec4 cb = at(u2 - vec2(ca, 0.0));
    c = vec4(min(cr.r, max(cr.a, cg.a)), cg.g, min(cb.b, max(cb.a, cg.a)), max(cg.a, max(cr.a, cb.a)));
  } else if (uType == 7) {     // RGB split
    float off = 0.025 * uAmount;
    vec4 cr = at(uv + vec2(off, 0.0));
    vec4 cb = at(uv - vec2(off, 0.0));
    c = vec4(cr.r, c.g, cb.b, max(c.a, max(cr.a, cb.a)));
  } else if (uType == 8) {     // chromatic aberration (radial)
    vec2 d = uv - 0.5;
    float k = 0.05 * uAmount;
    vec4 cr = at(uv + d * k);
    vec4 cb = at(uv - d * k);
    c = vec4(cr.r, c.g, cb.b, max(c.a, max(cr.a, cb.a)));
  } else if (uType == 9) {     // directional (motion) blur, uParam = full streak in uv
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 16; i++) {
      float f = float(i) / 15.0 - 0.5;
      acc += at(uv + uParam * f);
    }
    c = acc / 16.0;
  }
  o = c;
}`;

/** Transition between two full-canvas renders (premultiplied, transparent where empty). */
export const FS_TRANSITION = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uP;
uniform int uType;
uniform vec2 uSize;
uniform float uBlurPx;
out vec4 o;
${COMMON}
vec4 samp(sampler2D t, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(t, uv);
}
vec4 blur(sampler2D t, vec2 uv, float r) {
  vec4 a = vec4(0.0);
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) a += texture(t, uv + vec2(float(x), float(y)) * r / uSize);
  return a / 25.0;
}
void main() {
  float p = clamp(uP, 0.0, 1.0);
  vec2 uv = vUv;
  vec4 a = texture(uFrom, uv);
  vec4 b = texture(uTo, uv);
  vec4 c;
  if (uType == 0) {                 // fade through the background
    c = p < 0.5 ? a * (1.0 - 2.0 * p) : b * (2.0 * p - 1.0);
  } else if (uType == 1) {          // dissolve (noise pattern)
    float n = hash(floor(uv * uSize / 3.0));
    c = mix(a, b, smoothstep(n - 0.06, n + 0.06, p * 1.12 - 0.06));
  } else if (uType == 2) {          // crossfade
    c = mix(a, b, p);
  } else if (uType == 3) {          // wipe left: edge travels right → left
    float e = 1.0 - p;
    c = mix(a, b, smoothstep(e - 0.005, e + 0.005, uv.x));
  } else if (uType == 4) {          // wipe right
    c = mix(b, a, smoothstep(p - 0.005, p + 0.005, uv.x));
  } else if (uType == 5) {          // wipe up: edge travels bottom → top
    c = mix(b, a, smoothstep(p - 0.005, p + 0.005, uv.y));
  } else if (uType == 6) {          // wipe down
    float e = 1.0 - p;
    c = mix(a, b, smoothstep(e - 0.005, e + 0.005, uv.y));
  } else if (uType == 7) {          // zoom in
    vec4 fa = samp(uFrom, (uv - 0.5) / (1.0 + p) + 0.5);
    vec4 fb = samp(uTo, (uv - 0.5) / (0.5 + 0.5 * p) + 0.5);
    c = mix(fa, fb, smoothstep(0.3, 0.7, p));
  } else if (uType == 8) {          // zoom out
    vec4 fa = samp(uFrom, (uv - 0.5) / (1.0 - 0.5 * p) + 0.5);
    vec4 fb = samp(uTo, (uv - 0.5) / (2.0 - p) + 0.5);
    c = mix(fa, fb, smoothstep(0.3, 0.7, p));
  } else if (uType == 9) {          // slide left: the next clip pushes in from the right
    c = uv.x < 1.0 - p ? samp(uFrom, uv + vec2(p, 0.0)) : samp(uTo, uv - vec2(1.0 - p, 0.0));
  } else if (uType == 10) {         // slide right
    c = uv.x > p ? samp(uFrom, uv - vec2(p, 0.0)) : samp(uTo, uv + vec2(1.0 - p, 0.0));
  } else {                          // blur
    float r = sin(3.14159265 * p) * uBlurPx;
    c = mix(blur(uFrom, uv, r), blur(uTo, uv, r), smoothstep(0.35, 0.65, p));
  }
  o = c;
}`;
