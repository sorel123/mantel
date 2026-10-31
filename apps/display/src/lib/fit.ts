import type { Fit, PanelSize } from '@mantel/shared';
import { useEffect, useState } from 'react';

/** The panel's logical size in CSS pixels and the transform that puts it on the viewport. */
export interface PanelFit extends PanelSize {
  scale: number;
}

/** How the panel meets the display: the fit mode and, for `scale`, the zoom. */
export interface FitOptions {
  fit: Fit;
  scale: number;
}

export const DEFAULT_FIT: FitOptions = { fit: 'fit', scale: 1 };

/** Widen or narrow the panel to the viewport's aspect when it is within this much, else letterbox. */
const ASPECT_TOLERANCE = 0.18;

/**
 * Where the panel sits on a `vw` by `vh` viewport.
 *
 * - `fit`: keep the design's panel. A viewport near its aspect widens or narrows the panel
 *   (the vertical metrics stay); any other aspect letterboxes.
 * - `fill`: the panel takes the viewport's aspect exactly, so the grid reaches every edge and
 *   cards grow while type stays the design size.
 * - `scale`: fill, then zoom by `scale` (1.2 makes everything a fifth bigger, so the panel
 *   holds less; 0.9 makes it smaller and holds more).
 */
export function fitPanel(
  panel: PanelSize,
  vw: number,
  vh: number,
  { fit, scale: zoom }: FitOptions = DEFAULT_FIT,
): PanelFit {
  const want = vw / vh;
  const have = panel.width / panel.height;
  let { width, height } = panel;
  if (fit === 'fit') {
    if (Math.abs(want - have) / have <= ASPECT_TOLERANCE) width = Math.round(panel.height * want);
  } else {
    // Match the viewport's shape: keep the design's height on wide displays, its width on tall ones.
    if (want >= have) width = Math.round(panel.height * want);
    else height = Math.round(panel.width / want);
    if (fit === 'scale') {
      const k = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
      width = Math.round(width / k);
      height = Math.round(height / k);
    }
  }
  const scale = Math.max(0.1, Math.min(vw / width, vh / height));
  return { width, height, scale };
}

/**
 * The panel's size and the scale that fits it in the viewport, kept up to date on resize. With
 * the default fit a 1180×820 panel fills an iPad at ×1, a Surface (1440×960) at 1230×820 ×1.17,
 * and sits letterboxed on a 16:9 monitor; `fill` and `scale` reach the edges everywhere.
 */
export function useFitPanel(panel: PanelSize, options: FitOptions = DEFAULT_FIT): PanelFit {
  const { fit, scale } = options;
  const compute = () => fitPanel(panel, window.innerWidth, window.innerHeight, { fit, scale });
  const [state, setState] = useState(compute);
  useEffect(() => {
    const onResize = () => setState(compute());
    onResize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.width, panel.height, fit, scale]);
  return state;
}

/** Scale factor alone, for callers that size the panel themselves. */
export function useFitScale(width: number, height: number): number {
  return useFitPanel({ width, height }).scale;
}
