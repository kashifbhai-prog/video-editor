import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { useProjectStore } from './store/projectStore';
import { useMediaStore } from './store/mediaStore';
import { useUiStore } from './store/uiStore';
import { usePlaybackStore } from './store/playbackStore';
import { previewEngine } from './engine/previewEngine';
import { previewSurface } from './engine/previewSurface';
import * as exportService from './services/exportService';
import * as aiServices from './services/ai';

// Expose stores in development for debugging and automated UI tests.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __stores: { project: useProjectStore, media: useMediaStore, ui: useUiStore, playback: usePlaybackStore, engine: previewEngine, surface: previewSurface, exporter: exportService, ai: aiServices },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
