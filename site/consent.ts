// ---------------------------------------------------------------------------
// Cookie consent (website pages and editor). Google Analytics / AdSense only
// get cookie access after "Accept" (Google Consent Mode v2: everything starts
// as "denied", see the bootstrap the site plugin puts in <head>). The banner
// only appears when tracking is configured (VITE_GA_ID / VITE_ADSENSE_CLIENT).
// ---------------------------------------------------------------------------

const KEY = 'vyora.consent.v1';
type Choice = 'granted' | 'denied';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    __vyoraTracking?: { ga: boolean; ads: boolean };
  }
}

function stored(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function apply(choice: Choice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: ask again next visit */
  }
  window.gtag?.('consent', 'update', {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  });
}

const CSS = `
.vy-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin-left:auto;
  padding:18px 20px;border-radius:14px;border:1px solid #34353c;background:#1c1d22;color:#e6e7ea;
  box-shadow:0 24px 70px -20px rgba(0,0,0,.9);font:14px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;
  animation:vy-consent-in .25s ease-out}
.vy-consent h2{margin:0 0 6px;font-size:15px;font-weight:700}
.vy-consent p{margin:0;color:#9a9ca5}
.vy-consent a{color:#8291ff}
.vy-consent .vy-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
.vy-consent button{height:36px;padding:0 16px;border-radius:9px;font:600 13px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;border:1px solid #34353c;background:#24252b;color:#e6e7ea}
.vy-consent button:hover{background:#2a2b32}
.vy-consent button.vy-accept{border-color:transparent;background:linear-gradient(135deg,#6c7cff,#8a6cff);color:#fff}
@keyframes vy-consent-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vy-consent{animation:none}}`;

function showBanner() {
  if (document.querySelector('.vy-consent')) return;
  if (!document.getElementById('vy-consent-css')) {
    const style = document.createElement('style');
    style.id = 'vy-consent-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const t = window.__vyoraTracking ?? { ga: false, ads: false };
  const what = [t.ga && 'measure traffic (Google Analytics)', t.ads && 'show ads (Google AdSense)'].filter(Boolean).join(' and ');
  const box = document.createElement('div');
  box.className = 'vy-consent';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cookie consent');
  box.innerHTML = `<h2>Cookies</h2>
    <p>We use cookies to ${what}. Your videos are never uploaded – editing happens in your browser.
    Read our <a href="/privacy/">Privacy Policy</a>.</p>
    <div class="vy-actions"><button type="button" class="vy-reject">Reject</button><button type="button" class="vy-accept">Accept</button></div>`;
  const close = (c: Choice) => {
    apply(c);
    box.remove();
  };
  box.querySelector('.vy-accept')!.addEventListener('click', () => close('granted'));
  box.querySelector('.vy-reject')!.addEventListener('click', () => close('denied'));
  document.body.appendChild(box);
}

function init() {
  const t = window.__vyoraTracking;
  if (!t || (!t.ga && !t.ads)) return; // nothing to consent to
  // "Cookie settings" links (footer) reopen the banner.
  document.querySelectorAll<HTMLElement>('[data-cookie-settings]').forEach((el) => {
    el.hidden = false;
    el.addEventListener('click', showBanner);
  });
  if (!stored()) showBanner();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export {};
