# Reelforge Studio

A browser-based professional video editor.

- **Phase 1** – UI and application foundation ✅
- **Phase 2** – Core editing engine (multi-track timeline, trim/split/move, synced preview) ✅
- **Phase 3** – Advanced tools: keyframes, transforms, transitions, effects, colour & filters, speed/reverse, text, stickers ✅
- **Phase 4** – Audio editing (gain, fades, EQ, balance, noise reduction, normalise, extract, voice-over) and real MP4 export ✅

## Run locally

Requires Node.js 18+ (tested on Node 22).

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck  # TypeScript project check
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

## Editing basics

- Add media to the timeline: hover a library item and click **+**, or drag it onto a track
  (drop below the last track to create a new one).
- Move clips by dragging (also onto other compatible tracks); trim by dragging clip edges.
- **S** split at playhead · **Del** delete · **Ctrl+D** duplicate · **Ctrl+C / Ctrl+V** copy/paste ·
  **Ctrl+Click** multi-select · **Ctrl+Z / Ctrl+Shift+Z** undo/redo · **Esc** cancels a drag.
- Click a library item to preview the source file; the **Timeline** tab returns to the edit.
- **Player**: click a layer to select it, drag to move, corner handles scale, the top knob rotates
  (Shift = 15° steps); double-click text to edit it in place.
- **Keyframes**: the ◇ next to Position / Scale / Rotation / Opacity / Volume adds a keyframe at the
  playhead. Once a property has keyframes, any change (slider or player handle) writes a keyframe at
  the playhead. Diamonds on the timeline clip can be dragged; easing is set per keyframe in
  Properties → Keyframes.
- **Transitions**: drag one from the Transitions library onto the cut between two touching clips (or
  select a clip and click a transition). **Effects / Filters**: click to apply to the selected clips,
  or drag onto a clip.
- **Text**: Text panel → pick a style; Urdu / Arabic are laid out right-to-left automatically.
- **Stickers**: built-in SVG stickers or your own PNG / WebP / SVG uploads, placed on overlay tracks.
- **Audio**: select a clip with sound → Properties → Audio (volume, gain, Normalize, fades, bass/treble,
  5-band EQ, balance, noise reduction, Extract audio). Track volume is in the track's properties.
  Audio panel → **Record voice-over** (asks for microphone permission when pressed).
- **Export** (Ctrl+E): preset, file name, aspect ratio, resolution, frame rate, codec and bitrates →
  progress with cancel → verified result with preview and download.

## Architecture

```
src/
  types/            Domain model: MediaItem (source) vs Clip (timeline instance), Track, ProjectDocument
  engine/
    timelineModel     PURE timing rules: durations, placement/overlap, trim, split, snapping, reverse
    sequence          builds a flat render-ready Sequence (items + transitions) from the document
    previewEngine     playback engine: master clock + per-clip media element pool
    keyframes         reusable keyframe engine (interpolation, easing, split / shift / scale)
    animation         animatable-property registry + per-frame clip evaluation (keyframes + presets)
    catalog           colour adjustments, filter presets, effects, transitions, text presets
    grade             colour adjustments + filter preset -> effective grade
    compositor        layer model + geometry (fit, anchor, rotation, crop) + 2D fallback renderer
    gl/glRenderer     WebGL2 compositor: grade pass, effect passes (pooled FBOs), transitions
    gl/shaders        GLSL: layer placement, colour grade, blur/glow/effects, 12 transitions
    textRenderer      Unicode / RTL text rasteriser with outline, shadow, background (cached)
    previewSurface    last rendered geometry (player handles and hit-testing)
    composition       SHARED composition model (live items, source frame per item, layer stack)
    audio             SHARED audio model: processing chain + gain envelope (preview and export)
    audioMixer        preview Web Audio graph (element → chain → envelope → track bus)
    export/           exporter (decode → compose → render → encode → mux → verify),
                      audioRender (offline mixdown), capabilities, exportSettings, colorMatch
  store/
    projectStore      undoable document (tracks, clips, transitions) with snapshot history
    mediaStore        media library, import pipeline, object-URL lifetimes
    uiStore           selection, preview mode, snapping, clipboard, panels (not undoable)
    playbackStore     reactive mirror of engine state (time, duration, playing)
  services/
    editingService    user-level edit commands used by toolbar, shortcuts, menus and drag & drop
    advancedEditing   Phase 3 commands: keyframes, transform, colour, filters, effects,
                      transitions, text, stickers, layer order
    projectService    save / restore / reset / export project file
    filmstrip         lazy timeline thumbnail extraction (memory only)
    exportService     export job state, progress, cancel, settings persistence
    audioEditing      normalise, extract audio, clip audio settings
    audioDsp          worker client (time-stretch, WAV, peak) + decoded-audio cache
    voiceRecorder     microphone recording → imported clip on the timeline
  workers/audioWorker WSOLA time-stretch, WAV encoding, peak scan (off the UI thread)
  assets/stickers     built-in original SVG stickers
  hooks/            sequence sync, keyboard shortcuts, autosave, global file drop, ...
  components/
    timeline/         Timeline, TimelineTrack, TimelineClip (keyframe diamonds), transition markers,
                      useClipDrag (move/trim interaction), dragStore (transient drag state)
    properties/       PropertiesPanel, ClipProperties + AdvancedSections, TransitionProperties
    library/          Text, Stickers, Effects, Transitions and Filters panels
    preview/          PreviewPlayer, TransformOverlay (handles, inline text editing)
    media/ navigation/ layout/ controls/
```

### Data model

- `MediaItem` = an imported file (binary in IndexedDB, never in the undo history).
- `Clip` = a timeline instance: `mediaId`, `trackId`, `start`, `sourceIn`, `sourceOut`, `speed`,
  `volume`, `opacity`, `transform {x, y, scale}`. Duration is derived:
  `(sourceOut − sourceIn) / speed`. One media item can be used by any number of clips.
- `ProjectDocument.clips` is a flat map keyed by id, so moving clips between tracks is a field change.
- Phase 3 adds optional clip fields (absent = neutral, so older projects stay valid): transform
  rotation / flips / anchor, `fit`, `crop`, `keyframes` (per property; times relative to the clip
  start), `color`, `filter`, `effects[]`, `animation` (in / out presets), `reversed`, and `text` for
  text clips (which have no media). `ProjectDocument.transitions` holds transitions between touching
  clips; they are pruned automatically when their clips stop touching.
- Keyframes follow the content: trimming the start shifts them, a speed change rescales them, and a
  split gives each part a boundary keyframe so the animation continues across the cut.

### Editing rules (engine/timelineModel.ts)

- Clips on one track never overlap. A dropped/moved/pasted clip that would overlap lands in the
  nearest free gap; a multi-clip move that would overlap is cancelled.
- Trims are clamped to the neighbouring clips, the source media length and a 0.1 s minimum.
  Still images and text can be extended freely.
- Visual clips move between video/overlay tracks; audio clips stay on audio tracks; text stays on
  text tracks; locked tracks reject all edits.

### Playback engine (engine/previewEngine.ts)

- A `requestAnimationFrame` master clock owns timeline time; media elements follow it.
- One media element per clip, created when the clip is active or about to start (preloaded
  1.5 s ahead), drift-corrected while playing, and released once the playhead moves away.
- Gaps render only the project background; the clock briefly holds while active video buffers.
- The same engine plays a single library item ("Source" preview mode).
- Transitions widen a clip's render range into its neighbour (centred on the cut): media beyond
  the in/out point is used when it exists, otherwise the first / last frame is held. Audio
  crossfades over the same window.
- Reversed clips are seek-driven (browsers cannot play video backwards): each decoded frame is shown
  before the next seek is issued, and the last frame is held while seeking.

### Rendering (engine/gl/glRenderer.ts)

Per visual layer: upload the source (video frame / image / text bitmap) → colour-grade pass →
effect passes ping-ponged through pooled framebuffers at the layer's on-screen size → one
transformed, cropped, premultiplied-alpha quad on the canvas. Layers without grading or effects
skip straight to the quad. Transitions render both clips into canvas-sized framebuffers and mix
them in a shader. The WebGL canvas is then copied onto the visible preview canvas. Without WebGL2
a 2D fallback renders transforms, crop, text and crossfades only (no grading or effects).

### Undo / redo

Every edit is one `commit()` on the project store. Snapshots share structure (untouched clips and
tracks are the same objects), drags commit once on release, and slider / handle drags coalesce, so
history stays small. Multi-step commands (e.g. "create track + place clip") use `transaction()` to
form a single undo step. Limit: 100 steps.

## Persistence

- Project document → `localStorage`; media blobs → IndexedDB (unreferenced blobs are cleaned up).
- Projects saved by Phase 1 / 2 are migrated automatically on load.
- Unsaved imports are discarded on reload. Very large files can exceed the browser storage quota;
  those are flagged as "session only".

### Export pipeline (engine/export)

1. **Prepare** – the same `Sequence` the preview plays; every video source is opened with
   Mediabunny (MP4/MOV/WebM/MKV demux + WebCodecs decode) for frame-accurate access; each
   source's colour conversion is calibrated against the browser's `<video>` output so exported
   colours match the preview.
2. **Audio** – OfflineAudioContext mixdown through the same chain and envelopes as the preview;
   speed changes are time-stretched with pitch preserved (worker).
3. **Video** – for each output frame: decode the exact source frames (sampled at the frame's
   centre), compose with the shared composition model, render with the same WebGL renderer, and
   encode with WebCodecs (H.264 or HEVC, hardware when the browser offers it).
4. **Mux** – MP4 (fast-start) with AAC audio (Opus if AAC encoding is unavailable).
5. **Verify** – the produced file is re-opened: dimensions, duration, audio track and decodable
   first/last frames are checked before the export is reported as done.

The rendered file exists only as an in-memory Blob / object URL (released on "Export again" or a
new export); it is never written into the project. Export settings are saved with the project.

**Why not FFmpeg.wasm:** WebCodecs gives hardware-accelerated H.264/HEVC/AAC directly (measured 4K
at 35 fps on the test machine), while FFmpeg.wasm encodes in software inside WebAssembly (typically
10–50× slower), adds a ~30 MB download, and needs cross-origin isolation for threads. Mediabunny
handles demuxing and muxing in a few hundred KB, loaded only when the Export dialog opens.

### Browser support for export

| Browser | Export |
|---|---|
| Chrome / Edge 94+ | Supported (tested: Chrome on Windows, hardware H.264 up to 4K, HEVC up to 1080p, AAC) |
| Safari 16.4+ / Firefox 130+ | WebCodecs present; NOT tested. Codec availability varies (Firefox has no AAC encoder → Opus audio; HEVC usually unavailable) |
| Older browsers | Export disabled with an explanation (no WebCodecs) |

The Export dialog probes the real encoder and GPU and only enables resolutions / codecs that work.

## Known limitations (Phase 4)

- Rendering runs on the main thread in short slices (decoders, encoders and the audio mixdown run
  on browser threads; audio DSP in a worker). The UI stays responsive (measured p95 frame gap 19 ms
  during a 4K export) but heavy projects make the editor slower while exporting.
- The whole output is buffered in memory before download; very long 4K exports can exhaust memory
  (the export fails with a clear message rather than producing a broken file).
- Phone videos with rotation metadata have not been tested in export.
- Noise reduction is a rumble filter + noise gate, not spectral denoising: it removes noise between
  sounds, not noise underneath speech.
- Preview audio goes through Web Audio once playback has been started (a user gesture); output
  latency of the audio device is not compensated.

## Known limitations (Phase 3)

- Speed ramping / speed keyframes are not implemented: speed is constant per clip (split a clip to
  vary it). Speed changes use the browser's playback rate.
- Reverse preview is seek-driven: smooth only on intra-frame or short-GOP media; reversed audio is muted.
- Motion blur derives from the clip's keyframed movement (or a fixed horizontal streak when static);
  there is no per-pixel motion estimation.
- Transitions are centred on the cut and use media handles where they exist; at a media boundary the
  first / last frame is held.
- Web fonts (Inter, Noto Naskh Arabic, Noto Nastaliq Urdu) load from Google Fonts; offline, text
  falls back to system fonts.
