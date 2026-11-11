import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';

const PROPERTIES_BREAKPOINT = 1180;
const LIBRARY_BREAKPOINT = 860;

/** Collapses side panels when the viewport crosses narrow breakpoints. */
export function useResponsivePanels() {
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const apply = (initial: boolean) => {
      const w = window.innerWidth;
      const ui = useUiStore.getState();
      const crossedDown = (bp: number) => (initial || lastWidth >= bp) && w < bp;
      const crossedUp = (bp: number) => lastWidth < bp && w >= bp;
      if (crossedDown(PROPERTIES_BREAKPOINT)) ui.setPropertiesOpen(false);
      if (crossedUp(PROPERTIES_BREAKPOINT)) ui.setPropertiesOpen(true);
      if (crossedDown(LIBRARY_BREAKPOINT)) ui.setLibraryOpen(false);
      if (crossedUp(LIBRARY_BREAKPOINT)) ui.setLibraryOpen(true);
      // Keep the timeline within bounds when the window shrinks.
      ui.setTimelineHeight(ui.timelineHeight);
      lastWidth = w;
    };
    apply(true);
    const onResize = () => apply(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}
