export const PREVIEW_STAGE_ID = 'preview-stage';

export function togglePreviewFullscreen() {
  const stage = document.getElementById(PREVIEW_STAGE_ID);
  if (!stage) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  else stage.requestFullscreen?.().catch(() => undefined);
}
