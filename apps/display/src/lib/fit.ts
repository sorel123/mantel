import type { PanelSize } from '@mantel/shared';
import { useEffect, useState } from 'react';

export interface Fit extends PanelSize {
  scale: number;
}

/** Widen or narrow the panel to the viewport's aspect when it is within this much, else letterbox. */
const ASPECT_TOLERANCE = 0.18;

export function fitPanel(panel: PanelSize, vw: number, vh: number): Fit {
  const want = vw / vh;
  const have = panel.width / panel.height;
  const { height } = panel;
  let width = panel.width;
  if (Math.abs(want - have) / have <= ASPECT_TOLERANCE) {
    // Keep the design's vertical metrics; give the extra width to the layout.
    width = Math.round(panel.height * want);
  }
  const scale = Math.max(0.1, Math.min(vw / width, vh / height));
  return { width, height, scale };
}

/**
 * The panel's size and the scale that fits it in the viewport. A 1180×820 panel fills an iPad
 * at ×1, a Surface (1440×960) at 1230×820 ×1.17, and sits letterboxed on a 16:9 monitor.
 */
export function useFitPanel(panel: PanelSize): Fit {
  const compute = () => fitPanel(panel, window.innerWidth, window.innerHeight);
  const [fit, setFit] = useState(compute);
  useEffect(() => {
    const onResize = () => setFit(compute());
    onResize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.width, panel.height]);
  return fit;
}

/** Scale factor alone, for callers that size the panel themselves. */
export function useFitScale(width: number, height: number): number {
  return useFitPanel({ width, height }).scale;
}
