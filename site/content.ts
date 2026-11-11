// ---------------------------------------------------------------------------
// Website structure shared by the build plugin (layout, help sidebar,
// sitemap) and the browser script (help search). Plain data, no DOM / Node.
// ---------------------------------------------------------------------------

export interface HelpArticle {
  slug: string;
  title: string;
  /** One line, shown in the help index, search results and meta description. */
  summary: string;
  /** Extra words for the search box. */
  keywords: string;
  group: string;
}

export const HELP_GROUPS = ['Basics', 'Editing', 'Creative tools', 'Audio', 'AI tools', 'Export & projects', 'Reference'] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: 'getting-started', group: 'Basics', title: 'Getting started', summary: 'A tour of the editor, importing your first files and making your first edit.', keywords: 'start begin tour interface import media library panels first video' },
  { slug: 'timeline-editing', group: 'Editing', title: 'Editing on the timeline', summary: 'Add, move, trim, split, copy and delete clips; snapping, zoom, undo and the right-click menu.', keywords: 'timeline clip move trim split cut copy paste duplicate delete snapping zoom undo redo select context menu right click' },
  { slug: 'tracks', group: 'Editing', title: 'Tracks and layers', summary: 'Video, overlay, text and audio tracks: adding, locking, muting, hiding and track volume.', keywords: 'track layer overlay lock mute hide order volume add remove' },
  { slug: 'player', group: 'Editing', title: 'The player (preview)', summary: 'Playback, frame stepping, preview quality, aspect ratio, fullscreen and source preview.', keywords: 'player preview play pause frame step quality aspect ratio fullscreen volume source' },
  { slug: 'video-and-images', group: 'Creative tools', title: 'Video and image clips', summary: 'Position, scale, rotation, flip, crop, fit, opacity, speed, reverse, keyframes and animations.', keywords: 'transform position scale rotate rotation flip crop fit fill opacity speed slow motion fast reverse keyframe animation' },
  { slug: 'color-effects-transitions', group: 'Creative tools', title: 'Colour, filters, effects and transitions', summary: 'Colour correction, ready-made filters, 12 effects and 12 transitions.', keywords: 'color colour brightness contrast saturation exposure temperature filter effect blur glow vignette glitch transition fade wipe slide zoom' },
  { slug: 'text-and-stickers', group: 'Creative tools', title: 'Text, titles and stickers', summary: 'Text styles, fonts, outline and shadow, Urdu and Arabic text, stickers and your own images.', keywords: 'text title font outline shadow urdu arabic rtl sticker image overlay lower third' },
  { slug: 'audio', group: 'Audio', title: 'Audio editing', summary: 'Volume, gain, normalize, fades, EQ, balance, noise reduction, extract audio and voice-over.', keywords: 'audio sound volume gain normalize fade equalizer eq bass treble balance pan noise reduction extract voice over record microphone music' },
  { slug: 'ai-captions', group: 'AI tools', title: 'Auto captions and subtitles', summary: 'Turn speech into editable, styled captions in English, Urdu and more – and import or export SRT files.', keywords: 'captions subtitles transcription speech to text whisper urdu english srt' },
  { slug: 'ai-tools', group: 'AI tools', title: 'AI tools: silence, enhancement, smart cuts, background, highlights', summary: 'Remove pauses, clean up voices, find scene changes, remove backgrounds and build highlight reels.', keywords: 'ai silence removal pauses enhance noise rnnoise voice loudness smart cuts scene detection duplicate background removal green screen summary highlights' },
  { slug: 'export', group: 'Export & projects', title: 'Exporting your video', summary: 'Presets, resolution up to 4K, frame rate, H.264 / HEVC, bitrate, progress and download.', keywords: 'export render download mp4 h.264 hevc 4k 1080p 720p frame rate bitrate quality preset' },
  { slug: 'projects-and-storage', group: 'Export & projects', title: 'Projects, saving and storage', summary: 'Where your work is saved, autosave, project files and what clearing browser data does.', keywords: 'project save autosave storage browser indexeddb json backup restore' },
  { slug: 'keyboard-shortcuts', group: 'Reference', title: 'Keyboard shortcuts', summary: 'Every keyboard shortcut in one table.', keywords: 'keyboard shortcuts hotkeys keys' },
  { slug: 'troubleshooting', group: 'Reference', title: 'Troubleshooting and FAQ', summary: 'Supported browsers, performance tips, AI model downloads and privacy questions.', keywords: 'faq problem error browser chrome firefox safari slow memory gpu model download privacy' },
];

export interface SitePage {
  path: string;
  title: string;
}

/** Pages listed in the sitemap (help articles are added from HELP_ARTICLES). */
export const SITE_PAGES: SitePage[] = [
  { path: '/', title: 'Home' },
  { path: '/help/', title: 'Help Center' },
  { path: '/about/', title: 'About' },
  { path: '/contact/', title: 'Contact' },
  { path: '/privacy/', title: 'Privacy Policy' },
  { path: '/terms/', title: 'Terms of Use' },
  { path: '/licenses/', title: 'Open-source licenses' },
];
