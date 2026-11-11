import type { Clip } from '../types';
import { filterPresetById, isNeutralColor, NEUTRAL_COLOR, COLOR_ADJUSTMENTS } from './catalog';
import type { Grade } from './compositor';

/**
 * Effective colour grade of a clip: its manual adjustments plus the filter
 * preset scaled by the filter intensity. Null when the result is neutral
 * (the renderer then skips the grade pass entirely).
 */
export function effectiveGrade(clip: Clip): Grade | null {
  const preset = clip.filter ? filterPresetById(clip.filter.presetId) : undefined;
  const k = preset ? clip.filter!.intensity : 0;
  if (isNeutralColor(clip.color) && (!preset || k <= 0)) return null;
  const adjust = { ...NEUTRAL_COLOR, ...clip.color };
  if (preset && k > 0) {
    for (const { key, min, max } of COLOR_ADJUSTMENTS) {
      adjust[key] = Math.min(max, Math.max(min, adjust[key] + (preset.adjust[key] ?? 0) * k));
    }
  }
  const scale = (v?: [number, number, number]): [number, number, number] => (v ? [v[0] * k, v[1] * k, v[2] * k] : [0, 0, 0]);
  return { adjust, shadowTint: scale(preset?.shadowTint), highlightTint: scale(preset?.highlightTint) };
}
