// ---------------------------------------------------------------------------
// Anonymous feature-usage events for Google Analytics (only when the site is
// configured with a GA id AND the visitor accepted cookies – the consent
// banner and gtag bootstrap live in /site). Never send file names, text or
// any project content: only which feature was used and its settings.
// ---------------------------------------------------------------------------

type Params = Record<string, string | number | boolean>;

export function track(event: string, params: Params = {}) {
  try {
    (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', event, params);
  } catch {
    /* analytics must never break the editor */
  }
}
