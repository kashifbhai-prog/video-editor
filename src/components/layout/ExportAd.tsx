import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// One AdSense display ad shown while an export renders (the user is waiting
// anyway). It never blocks or delays the export: if the ad is blocked, not
// filled or AdSense is not configured, the box simply disappears.
//
// The AdSense script is loaded only here, without the "?client=" parameter,
// so Auto ads never place ads anywhere else in the editor.
//   VITE_ADSENSE_CLIENT  publisher id (ca-pub-…)
//   VITE_ADSENSE_SLOT    display ad unit id (recommended; ads may not fill without it)
// ---------------------------------------------------------------------------

const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) ?? '';
const SLOT = (import.meta.env.VITE_ADSENSE_SLOT as string | undefined) ?? '';
const SCRIPT_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let scriptPromise: Promise<void> | null = null;
function loadAdScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = SCRIPT_SRC;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null; // ad blocker / offline: try again next export
      reject(new Error('ad script blocked'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export const exportAdsEnabled = () => !!CLIENT && !/^(localhost|127\.|\[::1\])/.test(location.hostname);

export function ExportAd() {
  const insRef = useRef<HTMLModElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const ins = insRef.current;
    if (!ins) return;
    let alive = true;
    // AdSense marks the slot data-ad-status="unfilled" when it has nothing to show.
    const obs = new MutationObserver(() => {
      if (ins.dataset.adStatus === 'unfilled') setHidden(true);
    });
    obs.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    loadAdScript()
      .then(() => {
        if (!alive || ins.dataset.adsbygoogleStatus) return;
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      })
      .catch(() => alive && setHidden(true));
    return () => {
      alive = false;
      obs.disconnect();
    };
  }, []);

  if (hidden) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-1" data-testid="export-ad">
      <span className="text-[9px] uppercase tracking-wider text-fg-subtle">Advertisement</span>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'inline-block', width: 336, height: 280 }}
        data-ad-client={CLIENT}
        {...(SLOT ? { 'data-ad-slot': SLOT } : {})}
      />
    </div>
  );
}
