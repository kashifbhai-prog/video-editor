import { useEffect } from 'react';
import { previewEngine } from '../engine/previewEngine';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useMediaStore } from '../store/mediaStore';
import { usePlaybackStore } from '../store/playbackStore';
import { saveProject } from '../services/projectService';
import {
  copySelection,
  cutSelection,
  trimSelectedToPlayhead,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  selectAllClips,
  splitSelectedAtPlayhead,
} from '../services/editingService';
import { openFilePicker } from '../utils/filePicker';
import { togglePreviewFullscreen } from '../utils/fullscreen';

export interface ShortcutInfo {
  keys: string;
  action: string;
}

/** Single source of truth for the shortcut reference shown in Settings. */
export const SHORTCUTS: ShortcutInfo[] = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: '← / →', action: 'Previous / next frame' },
  { keys: 'Shift + ← / →', action: 'Back / forward 1 second' },
  { keys: 'Home / End', action: 'Jump to start / end' },
  { keys: 'S', action: 'Split selected clip at playhead' },
  { keys: 'Q / W', action: 'Trim selected clip start / end to playhead' },
  { keys: 'Delete / Backspace', action: 'Delete selected clips (or track)' },
  { keys: 'Ctrl + C / Ctrl + V', action: 'Copy / paste clips at playhead' },
  { keys: 'Ctrl + X', action: 'Cut selected clips' },
  { keys: 'Ctrl + D', action: 'Duplicate selected clips' },
  { keys: 'Ctrl + A', action: 'Select all clips' },
  { keys: 'Ctrl + Click', action: 'Add / remove clip from selection' },
  { keys: 'Ctrl + Z', action: 'Undo' },
  { keys: 'Ctrl + Shift + Z / Ctrl + Y', action: 'Redo' },
  { keys: 'Ctrl + S', action: 'Save project' },
  { keys: 'Ctrl + I', action: 'Import media' },
  { keys: 'Ctrl + E', action: 'Open export dialog' },
  { keys: 'M', action: 'Mute / unmute preview' },
  { keys: 'F', action: 'Fullscreen preview' },
  { keys: '= / -', action: 'Zoom timeline in / out' },
  { keys: 'Esc', action: 'Clear selection / close dialog' },
  { keys: 'Drag in player', action: 'Move the selected layer (handles: scale / rotate)' },
  { keys: 'Shift + rotate handle', action: 'Rotate in 15° steps' },
  { keys: 'Double-click text (player)', action: 'Edit text in place (Ctrl + Enter to finish)' },
  { keys: 'Delete (transition selected)', action: 'Remove the transition' },
  { keys: 'Right-click a clip', action: 'Clip menu (actions and details)' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (target.isContentEditable) return true;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
  }
  return false;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const project = useProjectStore.getState();
      const ui = useUiStore.getState();

      if (e.key === 'Escape') {
        if (ui.dialog) ui.openDialog(null);
        else ui.setSelection({ kind: 'none' });
        return;
      }

      // Global shortcuts that work even while a dialog is open.
      if (mod && key === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }

      // Never steal keys from text fields (they need Ctrl+C/V/Z, arrows, Backspace, S...).
      if (ui.dialog || isTypingTarget(e.target)) return;

      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          project.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          project.redo();
        } else if (key === 'i') {
          e.preventDefault();
          openFilePicker().then((files) => useMediaStore.getState().importFiles(files));
        } else if (key === 'e') {
          e.preventDefault();
          ui.openDialog('export');
        } else if (key === 'c') {
          if (ui.selection.kind === 'clips') {
            e.preventDefault();
            copySelection();
          }
        } else if (key === 'x') {
          if (ui.selection.kind === 'clips') {
            e.preventDefault();
            cutSelection();
          }
        } else if (key === 'v') {
          e.preventDefault();
          pasteClipboard();
        } else if (key === 'd') {
          e.preventDefault();
          duplicateSelection();
        } else if (key === 'a') {
          e.preventDefault();
          selectAllClips();
        }
        return;
      }
      if (e.altKey) return;

      const fps = project.document.canvas.frameRate;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          previewEngine.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) previewEngine.seek(usePlaybackStore.getState().currentTime - 1);
          else previewEngine.step(-1, fps);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) previewEngine.seek(usePlaybackStore.getState().currentTime + 1);
          else previewEngine.step(1, fps);
          break;
        case 'Home':
          e.preventDefault();
          previewEngine.seek(0);
          break;
        case 'End':
          e.preventDefault();
          previewEngine.seek(usePlaybackStore.getState().duration);
          break;
        case 's':
        case 'S':
          splitSelectedAtPlayhead();
          break;
        case 'q':
        case 'Q':
          trimSelectedToPlayhead('start');
          break;
        case 'w':
        case 'W':
          trimSelectedToPlayhead('end');
          break;
        case 'm':
        case 'M':
          previewEngine.setMuted(!usePlaybackStore.getState().muted);
          break;
        case 'f':
        case 'F':
          togglePreviewFullscreen();
          break;
        case '=':
        case '+':
          ui.zoomTimeline(1);
          break;
        case '-':
        case '_':
          ui.zoomTimeline(-1);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
