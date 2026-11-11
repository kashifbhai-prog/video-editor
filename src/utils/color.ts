/** Parses #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() into a 6-digit hex and an alpha (0..1). */
export function parseCssColor(css: string | null | undefined): { hex: string; alpha: number } {
  const s = (css ?? '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return { hex: `#${m[1].split('').map((c) => c + c).join('')}`.toLowerCase(), alpha: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return { hex: `#${m[1]}`.toLowerCase(), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) {
    const h = (v: string) => Math.round(Math.min(255, Number(v))).toString(16).padStart(2, '0');
    return { hex: `#${h(m[1])}${h(m[2])}${h(m[3])}`, alpha: m[4] !== undefined ? Math.min(1, Number(m[4])) : 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

/** #rrggbb (+ alpha) → #rrggbb or #rrggbbaa. */
export function composeColor(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a >= 255 ? hex : `${hex}${a.toString(16).padStart(2, '0')}`;
}
