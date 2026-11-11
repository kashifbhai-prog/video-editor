// ---------------------------------------------------------------------------
// Built-in stickers: small original SVG graphics with transparent
// backgrounds. Adding one imports it into the media library as a normal image
// (so it is saved with the project like any user upload).
// ---------------------------------------------------------------------------

export interface BuiltInSticker {
  id: string;
  name: string;
  svg: string;
}

const wrap = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${body}</svg>`;

export const BUILT_IN_STICKERS: BuiltInSticker[] = [
  {
    id: 'star',
    name: 'Star',
    svg: wrap(
      '<path d="M256 36l62 140 152 14-115 101 34 149-133-78-133 78 34-149L42 190l152-14z" fill="#ffd43b" stroke="#c78b00" stroke-width="14" stroke-linejoin="round"/>',
    ),
  },
  {
    id: 'heart',
    name: 'Heart',
    svg: wrap(
      '<path d="M256 452S48 330 48 178c0-70 52-118 112-118 44 0 76 24 96 58 20-34 52-58 96-58 60 0 112 48 112 118 0 152-208 274-208 274z" fill="#ff4d6d" stroke="#b3123a" stroke-width="14" stroke-linejoin="round"/>',
    ),
  },
  {
    id: 'bolt',
    name: 'Lightning',
    svg: wrap('<path d="M296 28L96 292h132l-36 192 228-276H286z" fill="#ffe066" stroke="#e67700" stroke-width="14" stroke-linejoin="round"/>'),
  },
  {
    id: 'bubble',
    name: 'Speech bubble',
    svg: wrap(
      '<path d="M76 72h360a40 40 0 0140 40v196a40 40 0 01-40 40H220l-96 84v-84H76a40 40 0 01-40-40V112a40 40 0 0140-40z" fill="#fff" stroke="#1c1d22" stroke-width="14" stroke-linejoin="round"/><text x="256" y="245" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="96" text-anchor="middle" fill="#1c1d22">WOW</text>',
    ),
  },
  {
    id: 'arrow',
    name: 'Arrow',
    svg: wrap('<path d="M40 210h260V100l172 156-172 156V302H40z" fill="#6c7cff" stroke="#2f3a9e" stroke-width="14" stroke-linejoin="round"/>'),
  },
  {
    id: 'badge-new',
    name: 'New badge',
    svg: wrap(
      '<circle cx="256" cy="256" r="200" fill="#2fbf71" stroke="#16794a" stroke-width="16"/><text x="256" y="290" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="104" text-anchor="middle" fill="#fff">NEW</text>',
    ),
  },
  {
    id: 'sun',
    name: 'Sun',
    svg: wrap(
      '<g stroke="#f08c00" stroke-width="22" stroke-linecap="round"><path d="M256 30v60M256 422v60M30 256h60M422 256h60M96 96l42 42M374 374l42 42M96 416l42-42M374 138l42-42"/></g><circle cx="256" cy="256" r="110" fill="#ffd43b" stroke="#f08c00" stroke-width="14"/>',
    ),
  },
  {
    id: 'check',
    name: 'Check mark',
    svg: wrap(
      '<circle cx="256" cy="256" r="210" fill="#4dabf7" stroke="#1864ab" stroke-width="14"/><path d="M150 262l70 70 142-150" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
  },
];

export const stickerDataUrl = (s: BuiltInSticker) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;

export const stickerFile = (s: BuiltInSticker) => new File([s.svg], `sticker-${s.id}.svg`, { type: 'image/svg+xml' });
