import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { HELP_ARTICLES, HELP_GROUPS, SITE_PAGES, TOOL_PAGES } from './content';

// ---------------------------------------------------------------------------
// Website build plugin. Each page is a small HTML file holding only its own
// content (<html data-layout="site" data-title=… data-description=…>); this
// plugin wraps it in the shared <head> (SEO, social cards, favicon), header,
// footer, help sidebar, consent bootstrap, Google Analytics and AdSense.
// It also writes robots.txt, sitemap.xml and (with an AdSense id) ads.txt.
//
// Settings come from environment variables (see .env.example):
//   VITE_SITE_URL        public address, e.g. https://www.cutistic.app
//   VITE_CONTACT_EMAIL   shown on Contact / Privacy / Terms
//   VITE_GA_ID           Google Analytics 4 measurement id (G-…)
//   VITE_ADSENSE_CLIENT  AdSense publisher id (ca-pub-…)
//   VITE_ADSENSE_SLOT    optional ad unit id for the in-page ad slots
// Without GA / AdSense ids nothing is loaded and no consent banner is shown.
// ---------------------------------------------------------------------------

export interface SiteSettings {
  siteUrl: string;
  contactEmail: string;
  gaId: string;
  adsenseClient: string;
  adsenseSlot: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (html: string, name: string) => new RegExp(`<html[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1] ?? '';

const ICON = {
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

/** Consent Mode v2 + GA bootstrap. Runs before any Google script. */
function trackingHead(s: SiteSettings, withAds: boolean): string {
  const ads = withAds && !!s.adsenseClient;
  if (!s.gaId && !ads) return '';
  const lines = [
    '<script>',
    'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}',
    "var __c=null;try{__c=localStorage.getItem('cutistic.consent.v1')}catch(e){}",
    "var __g=__c==='granted'?'granted':'denied';",
    "gtag('consent','default',{ad_storage:__g,ad_user_data:__g,ad_personalization:__g,analytics_storage:__g,wait_for_update:500});",
    `window.__cutisticTracking={ga:${s.gaId ? 'true' : 'false'},ads:${ads ? 'true' : 'false'}};`,
  ];
  if (s.gaId) lines.push("gtag('js',new Date());", `gtag('config','${esc(s.gaId)}');`);
  lines.push('</script>');
  if (s.gaId) lines.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(s.gaId)}"></script>`);
  if (ads) lines.push(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(s.adsenseClient)}" crossorigin="anonymous"></script>`);
  return lines.join('\n    ');
}

function header(nav: string): string {
  const link = (href: string, label: string, key: string) => `<a href="${href}" class="nav-link${nav === key ? ' is-active' : ''}">${label}</a>`;
  return `<header class="site-header">
  <div class="container header-inner">
    <a href="/" class="brand" aria-label="Cutistic home"><img src="/src/assets/logo.jpg" alt="Cutistic" width="113" height="32" class="logo-img" /></a>
    <nav class="main-nav" aria-label="Main">
      ${link('/#features', 'Features', 'features')}
      ${link('/help/', 'Help Center', 'help')}
      ${link('/about/', 'About', 'about')}
      ${link('/contact/', 'Contact', 'contact')}
    </nav>
    <div class="header-actions">
      <a href="/editor/" class="btn btn-primary btn-sm">Open editor ${ICON.arrow}</a>
      <button type="button" class="menu-toggle" aria-label="Menu" aria-expanded="false" data-menu-toggle>${ICON.menu}</button>
    </div>
  </div>
</header>`;
}

function footer(): string {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <img src="/src/assets/logo.jpg" alt="Cutistic" width="113" height="32" class="logo-img" />
      <p>The free video editor that runs entirely in your browser. Your files never leave your computer.</p>
    </div>
    <div>
      <h3>Product</h3>
      <a href="/editor/">Open the editor</a>
      <a href="/#features">Features</a>
      <a href="/#ai">AI tools</a>
      <a href="/help/">Help Center</a>
    </div>
    <div>
      <h3>Learn</h3>
      <a href="/help/getting-started/">Getting started</a>
      <a href="/help/ai-captions/">Auto captions</a>
      <a href="/help/export/">Exporting</a>
      <a href="/help/keyboard-shortcuts/">Keyboard shortcuts</a>
    </div>
    <div>
      <h3>Free tools</h3>
      ${TOOL_PAGES.map((t) => `<a href="/${t.slug}/">${esc(t.title)}</a>`).join('\n      ')}
    </div>
    <div>
      <h3>Company</h3>
      <a href="/about/">About</a>
      <a href="/contact/">Contact</a>
      <a href="/privacy/">Privacy Policy</a>
      <a href="/terms/">Terms of Use</a>
      <a href="/licenses/">Open-source licenses</a>
      <button type="button" class="link-button" data-cookie-settings hidden>Cookie settings</button>
    </div>
  </div>
  <div class="container footer-bottom">
    <span>© ${year} Cutistic. All rights reserved.</span>
    <span>Made for creators · No account needed</span>
  </div>
</footer>`;
}

function helpSidebar(active: string): string {
  const groups = HELP_GROUPS.map((g) => {
    const items = HELP_ARTICLES.filter((a) => a.group === g)
      .map((a) => `<a href="/help/${a.slug}/"${a.slug === active ? ' class="is-active" aria-current="page"' : ''}>${esc(a.title)}</a>`)
      .join('');
    return `<div class="side-group"><h4>${g}</h4>${items}</div>`;
  }).join('');
  return `<aside class="help-sidebar" aria-label="Help topics">
    <a href="/help/" class="side-home${active ? '' : ' is-active'}">Help Center home</a>
    ${groups}
  </aside>`;
}

function helpPager(slug: string): string {
  const i = HELP_ARTICLES.findIndex((a) => a.slug === slug);
  const prev = HELP_ARTICLES[i - 1];
  const next = HELP_ARTICLES[i + 1];
  return `<nav class="pager" aria-label="More articles">
    ${prev ? `<a href="/help/${prev.slug}/" class="pager-prev"><span>${ICON.back} Previous</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
    ${next ? `<a href="/help/${next.slug}/" class="pager-next"><span>Next ${ICON.arrow}</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
  </nav>`;
}

/** Cards linking to the other tool pages (the current one is left out). */
function moreTools(url: string): string {
  const cards = TOOL_PAGES.filter((t) => `/${t.slug}/` !== url)
    .map((t) => `<a class="card card-link" href="/${t.slug}/"><h3>${esc(t.title)}</h3><p>${esc(t.summary)}</p><span class="card-more">Learn more ${ICON.arrow}</span></a>`)
    .join('');
  return `<div class="grid grid-3">${cards}</div>`;
}

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * schema.org structured data (JSON-LD) so search engines understand what each page is:
 * the home page describes the site, the organisation and the app; tool pages the app plus a
 * breadcrumb; help articles an article plus a breadcrumb. Any FAQ (<details><summary>) on a
 * page becomes an FAQPage. Nothing invented – no ratings or reviews.
 */
function structuredData(o: { url: string; pageUrl: string; title: string; description: string; nav: string; body: string; s: SiteSettings }): string {
  const base = o.s.siteUrl.replace(/\/$/, '');
  const org = { '@type': 'Organization', '@id': `${base}/#org`, name: 'Cutistic', url: `${base}/`, logo: `${base}/apple-touch-icon.png` };
  const app = {
    '@type': 'SoftwareApplication',
    '@id': `${base}/#app`,
    name: 'Cutistic',
    url: `${base}/editor/`,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Video editor',
    operatingSystem: 'Any – runs in a web browser (Chrome, Edge) on Windows, macOS, Linux and ChromeOS',
    description:
      'Free video editor that runs in your browser: multi-track timeline, titles, transitions, effects, colour, audio mixing, AI auto captions, silence removal, noise removal and background removal. MP4 export up to 4K, no watermark, no sign-up.',
    image: `${base}/img/og-image.png`,
    screenshot: `${base}/img/editor-hero.webp`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    publisher: { '@id': `${base}/#org` },
    featureList: [
      'Multi-track timeline',
      'Titles and text in any language, including Urdu and Arabic',
      '12 transitions and 12 effects',
      'Colour correction and filters',
      'Keyframe animation',
      'Audio mixing, EQ and noise reduction',
      'AI auto captions and SRT subtitles',
      'AI silence removal',
      'AI background removal',
      'MP4 export up to 4K without watermark',
    ],
  };
  const crumbs = (items: [string, string][]) => ({
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${path}` })),
  });

  const graph: object[] = [];
  const helpSlug = o.nav === 'help' ? o.url.replace(/^\/help\/|\/$/g, '') : '';
  const article = HELP_ARTICLES.find((a) => a.slug === helpSlug);
  if (o.url === '/') {
    graph.push({ '@type': 'WebSite', '@id': `${base}/#website`, name: 'Cutistic', url: `${base}/`, description: o.description, publisher: { '@id': `${base}/#org` } }, org, app);
  } else if (o.nav === 'tool') {
    graph.push({ ...app, '@id': undefined, description: o.description, publisher: org }, crumbs([['Home', '/'], [o.title, o.url]]));
  } else if (article) {
    graph.push(
      { '@type': 'TechArticle', headline: article.title, description: o.description, url: o.pageUrl, image: `${base}/img/og-image.png`, inLanguage: 'en', author: { '@id': `${base}/#org` }, publisher: org, about: { '@id': `${base}/#app` } },
      crumbs([['Home', '/'], ['Help Center', '/help/'], [article.title, o.url]]),
    );
  } else if (o.url === '/help/') {
    graph.push(crumbs([['Home', '/'], ['Help Center', '/help/']]));
  }

  const faqs = [...o.body.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({
    '@type': 'Question',
    name: plain(m[1]),
    acceptedAnswer: { '@type': 'Answer', text: plain(m[2]) },
  }));
  if (faqs.length) graph.push({ '@type': 'FAQPage', mainEntity: faqs });
  if (!graph.length) return '';
  // "<" escaped so text can never close the script tag.
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/** Fills {{placeholders}} in page content. */
function fill(html: string, s: SiteSettings, url: string): string {
  const email = esc(s.contactEmail);
  return html
    .replace(/\{\{moreTools\}\}/g, () => moreTools(url))
    .replace(/\{\{email\}\}/g, email)
    .replace(/\{\{siteUrl\}\}/g, esc(s.siteUrl))
    .replace(/\{\{year\}\}/g, String(new Date().getFullYear()))
    .replace(/\{\{helpIndex\}\}/g, () =>
      HELP_GROUPS.map((g) => {
        const cards = HELP_ARTICLES.filter((a) => a.group === g)
          .map((a) => `<a class="card card-link" href="/help/${a.slug}/"><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><span class="card-more">Read guide ${ICON.arrow}</span></a>`)
          .join('');
        return `<section class="help-group"><h2>${g}</h2><div class="grid grid-3">${cards}</div></section>`;
      }).join(''),
    )
    .replace(/\{\{searchIcon\}\}/g, ICON.search)
    .replace(/<div class="ad-slot"([^>]*)><\/div>/g, (_m, rest) => (s.adsenseClient ? `<div class="ad-slot"${rest} data-client="${esc(s.adsenseClient)}" data-slot="${esc(s.adsenseSlot)}"></div>` : ''));
}

function renderPage(html: string, url: string, s: SiteSettings): string {
  const title = attr(html, 'data-title');
  const description = attr(html, 'data-description');
  const nav = attr(html, 'data-nav');
  const helpSlug = attr(html, 'data-help');
  const isHelp = nav === 'help';
  const body = fill(/<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '', s, url);
  const pageUrl = s.siteUrl.replace(/\/$/, '') + url;
  const fullTitle = url === '/' ? `${title}` : `${title} · Cutistic`;
  const ld = nav === '404' ? '' : structuredData({ url, pageUrl, title, description, nav, body, s });
  const article = HELP_ARTICLES.find((a) => a.slug === helpSlug);
  const crumbs = isHelp
    ? `<nav class="crumbs container" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/help/">Help Center</a>${article ? `<span>/</span><span aria-current="page">${esc(article.title)}</span>` : ''}</nav>`
    : '';
  const main = isHelp
    ? `${crumbs}<div class="container help-layout">${helpSidebar(helpSlug)}<main id="main" class="help-main">${body}${article ? helpPager(helpSlug) : ''}</main></div>`
    : `<main id="main">${body}</main>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(pageUrl)}" />
    <meta name="theme-color" content="#0e0f12" />${nav === '404' ? '<meta name="robots" content="noindex" />' : ''}
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="${article ? 'article' : 'website'}" />
    <meta property="og:site_name" content="Cutistic" />
    <meta property="og:title" content="${esc(fullTitle)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(pageUrl)}" />
    <meta property="og:image" content="${esc(s.siteUrl.replace(/\/$/, ''))}/img/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />${ld ? `\n    ${ld}` : ''}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap" />
    <link rel="stylesheet" href="/site/site.css" />
    ${trackingHead(s, true)}
  </head>
  <body class="site${isHelp ? ' page-help' : ''}" data-page="${esc(nav || 'page')}">
    <a href="#main" class="skip-link">Skip to content</a>
    ${header(nav)}
    ${main}
    ${footer()}
    <script type="module" src="/site/site.ts"></script>
  </body>
</html>`;
}

function sitemap(s: SiteSettings): string {
  const base = s.siteUrl.replace(/\/$/, '');
  const urls = [...SITE_PAGES.map((p) => p.path), ...TOOL_PAGES.map((t) => `/${t.slug}/`), ...HELP_ARTICLES.map((a) => `/help/${a.slug}/`), '/editor/'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

const robots = (s: SiteSettings) => `User-agent: *\nAllow: /\n\nSitemap: ${s.siteUrl.replace(/\/$/, '')}/sitemap.xml\n`;
/** ads.txt: authorises Google to sell ads on this domain (publisher id without "ca-"). */
const adsTxt = (s: SiteSettings) => `google.com, ${s.adsenseClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`;

/** All HTML entry points of the website + editor (for the multi-page build). */
export function htmlEntries(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set(['node_modules', 'dist', 'src', 'public', 'site', '.git', '.vite']);
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!skip.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name));
      } else if (e.name === 'index.html' || (dir === root && e.name === '404.html')) {
        const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
        out[rel.replace(/\/?index\.html$/, '').replace(/\.html$/, '') || 'home'] = path.join(dir, e.name);
      }
    }
  };
  walk(root);
  return out;
}

export function cutisticSite(s: SiteSettings): Plugin {
  return {
    name: 'cutistic-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (/<html[^>]*data-layout="site"/.test(html)) {
          const url = ctx.path.replace(/index\.html$/, '').replace(/\.html$/, '/') || '/';
          return renderPage(html, url === '/404/' ? '/404' : url, s);
        }
        // The editor gets the consent bootstrap + Analytics, never ads.
        const head = trackingHead(s, false);
        return head ? html.replace('</head>', `    ${head}\n  </head>`) : html;
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = req.url?.split('?')[0];
        if (u === '/robots.txt') return void res.end(robots(s));
        if (u === '/sitemap.xml') return void (res.setHeader('content-type', 'application/xml'), res.end(sitemap(s)));
        if (u === '/ads.txt' && s.adsenseClient) return void res.end(adsTxt(s));
        if (u === '/editor') return void (res.statusCode = 301, res.setHeader('location', '/editor/'), res.end());
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots(s) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(s) });
      if (s.adsenseClient) this.emitFile({ type: 'asset', fileName: 'ads.txt', source: adsTxt(s) });
    },
  };
}
