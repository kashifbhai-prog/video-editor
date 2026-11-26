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

/**
 * Landing pages for common searches ("add subtitles to video", "remove background noise"…).
 * Each lives at /<slug>/ (a folder with index.html, data-nav="tool"). They are linked from the
 * footer and from each other ({{moreTools}}), and listed in the sitemap.
 */
export interface ToolPage {
  slug: string;
  /** Short name for links and cards. */
  title: string;
  /** One line for the cards that link to the page. */
  summary: string;
}

export const TOOL_PAGES: ToolPage[] = [
  { slug: 'free-video-editor-no-watermark', title: 'Free video editor – no watermark', summary: 'A complete online video editor: no sign-up, no watermark, MP4 export up to 4K.' },
  { slug: 'add-subtitles-to-video', title: 'Add subtitles to video', summary: 'Generate captions from speech automatically, edit them and burn them in or save SRT.' },
  { slug: 'urdu-subtitles', title: 'Urdu subtitles generator', summary: 'Turn Urdu speech into Urdu captions in Nastaliq script – free and in your browser.' },
  { slug: 'remove-background-noise-from-video', title: 'Remove background noise', summary: 'Clean fan, traffic and hum out of a voice with AI noise removal – before/after preview.' },
  { slug: 'remove-silence-from-video', title: 'Remove silence from video', summary: 'Find every pause in a talking video and cut them all at once, with captions in sync.' },
  { slug: 'remove-video-background', title: 'Remove video background', summary: 'Remove the background behind a person – no green screen – and replace it with anything.' },
];

/**
 * Blog articles: longer, original guides about making videos (not just how a button works).
 * Each lives at /blog/<slug>/index.html (data-nav="blog" data-post="<slug>"). Newest first.
 */
export interface BlogPost {
  slug: string;
  title: string;
  /** One or two sentences for the cards and the meta description. */
  summary: string;
  /** Publication date, YYYY-MM-DD. */
  date: string;
  /** Updated date, YYYY-MM-DD (defaults to date). */
  updated?: string;
  minutes: number;
  /** Card / social image under /img/. */
  image: string;
  imageAlt: string;
}

export const BLOG_POSTS: BlogPost[] = [
  { slug: 'edit-youtube-shorts-reels-tiktok', title: 'How to edit vertical videos for YouTube Shorts, Reels and TikTok', summary: 'A practical workflow for 9:16 videos: framing, the first three seconds, captions, pacing, music and the right export settings – all in your browser.', date: '2026-11-27', minutes: 8, image: 'editor-hero.webp', imageAlt: 'The Cutistic editor with a video on the timeline' },
  { slug: 'make-your-voice-sound-better-in-videos', title: '9 ways to make your voice sound better in videos (without buying a new mic)', summary: 'Most bad audio is fixed before you press record. Room, distance, levels – and then noise removal, EQ and loudness in the edit.', date: '2026-11-27', minutes: 7, image: 'audio.webp', imageAlt: 'Audio settings of a clip with volume, fades and equalizer' },
  { slug: 'best-video-export-settings', title: 'Best video export settings for YouTube, Instagram, TikTok and WhatsApp', summary: 'Resolution, frame rate, bitrate and codec explained in plain words – with simple settings that look good on every platform.', date: '2026-11-27', minutes: 6, image: 'export.webp', imageAlt: 'Export dialog with resolution, frame rate, codec and bitrate settings' },
  { slug: 'how-to-add-urdu-subtitles-to-video', title: 'How to add Urdu subtitles to a video (and get them right)', summary: 'Generate Urdu captions from speech, fix the common mistakes, style them in Nastaliq and decide between burned-in captions and SRT files.', date: '2026-11-27', minutes: 7, image: 'captions.webp', imageAlt: 'Generated captions in the caption editor' },
  { slug: 'edit-talking-head-videos', title: 'How to edit talking-head videos people actually watch to the end', summary: 'Jump cuts, removing pauses, punch-in zooms, B-roll and on-screen text: the editing habits that keep viewers watching.', date: '2026-11-27', minutes: 7, image: 'ai-silence.webp', imageAlt: 'Detected pauses shown as red bands on the timeline' },
  { slug: 'video-editing-terms-for-beginners', title: 'Video editing for beginners: 15 terms you need to know', summary: 'Timeline, track, trim, split, keyframe, aspect ratio, frame rate, bitrate, codec and more – explained simply, with an example for each.', date: '2026-11-27', minutes: 7, image: 'context-menu.webp', imageAlt: 'Right-click menu of a clip on the timeline' },
];

/** Pages listed in the sitemap (help articles, tool pages and blog posts are added separately). */
export const SITE_PAGES: SitePage[] = [
  { path: '/', title: 'Home' },
  { path: '/blog/', title: 'Blog' },
  { path: '/help/', title: 'Help Center' },
  { path: '/about/', title: 'About' },
  { path: '/contact/', title: 'Contact' },
  { path: '/privacy/', title: 'Privacy Policy' },
  { path: '/terms/', title: 'Terms of Use' },
  { path: '/licenses/', title: 'Open-source licenses' },
];
