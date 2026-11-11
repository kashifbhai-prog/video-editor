import './consent';
import { HELP_ARTICLES } from './content';

// ---------------------------------------------------------------------------
// Website behaviour: mobile menu, help search, "on this page" contents for
// help articles and filling the AdSense slots. No framework – small and fast.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// ---- Mobile menu --------------------------------------------------------------------
const header = document.querySelector<HTMLElement>('.site-header');
document.querySelector<HTMLButtonElement>('[data-menu-toggle]')?.addEventListener('click', (e) => {
  const open = !header?.classList.contains('is-open');
  header?.classList.toggle('is-open', open);
  (e.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(open));
});

// Help sidebar on small screens: the "Help Center home" row toggles the topic list.
const side = document.querySelector<HTMLElement>('.help-sidebar');
if (side && window.matchMedia('(max-width: 980px)').matches) {
  const home = side.querySelector<HTMLAnchorElement>('.side-home');
  if (home) {
    home.textContent = 'Browse all help topics';
    home.addEventListener('click', (e) => {
      e.preventDefault();
      side.classList.toggle('is-open');
    });
  }
}

// ---- Help search ----------------------------------------------------------------------
const input = document.querySelector<HTMLInputElement>('[data-help-search]');
const results = document.querySelector<HTMLElement>('[data-help-results]');
if (input && results) {
  const norm = (s: string) => s.toLowerCase();
  let active = -1;
  const render = () => {
    const q = norm(input.value.trim());
    active = -1;
    if (!q) {
      results.hidden = true;
      return;
    }
    const words = q.split(/\s+/);
    const hits = HELP_ARTICLES.map((a) => {
      const hay = norm(`${a.title} ${a.summary} ${a.keywords}`);
      const score = words.reduce((s, w) => s + (hay.includes(w) ? (norm(a.title).includes(w) ? 3 : 1) : -10), 0);
      return { a, score };
    })
      .filter((h) => h.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 8);
    results.innerHTML = hits.length
      ? hits.map(({ a }) => `<a href="/help/${a.slug}/">${a.title}<small>${a.summary}</small></a>`).join('')
      : '<div class="empty">No matching guide. Try other words, or <a href="/contact/">ask us</a>.</div>';
    results.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const links = [...results.querySelectorAll<HTMLAnchorElement>('a[href^="/help/"]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(links.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      links.forEach((l, i) => l.classList.toggle('is-active', i === active));
    } else if (e.key === 'Enter' && links.length) {
      e.preventDefault();
      window.location.href = links[Math.max(0, active)].href;
    } else if (e.key === 'Escape') {
      input.value = '';
      results.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.search')) results.hidden = true;
  });
}

// ---- "On this page" for help articles ---------------------------------------------------
const toc = document.querySelector<HTMLElement>('[data-toc]');
if (toc) {
  const heads = [...document.querySelectorAll<HTMLHeadingElement>('.prose h2')];
  heads.forEach((h) => {
    if (!h.id) h.id = h.textContent!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  });
  if (heads.length >= 3) {
    toc.innerHTML = `<strong>On this page</strong><ol>${heads.map((h) => `<li><a href="#${h.id}">${h.textContent}</a></li>`).join('')}</ol>`;
  } else toc.remove();
}

// ---- AdSense slots (only present when an AdSense id is configured) ----------------------
document.querySelectorAll<HTMLElement>('.ad-slot[data-client]').forEach((slot) => {
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = slot.dataset.client!;
  if (slot.dataset.slot) ins.dataset.adSlot = slot.dataset.slot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  slot.appendChild(ins);
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    slot.remove();
  }
});
