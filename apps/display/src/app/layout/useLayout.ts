import { layoutFromSearch, resolveLayout, type LayoutSettings } from '@mantel/shared';
import { useMemo } from 'react';
import { useBootstrap } from '../../lib/bootstrap';

/**
 * The display's own say: `?today=weather&month=week&fit=fill&scale=1.1` on its address pins
 * a layout for one display (kiosk shortcuts, screenshots, the smoke test).
 */
export const urlLayout = layoutFromSearch(location.search);

/**
 * The layout this display runs: the household setting from bootstrap, this display's
 * per-device overrides from its `Device` record (set under Settings → Displays), then its URL.
 * Only call below the shell, where bootstrap is loaded.
 */
export function useLayout(): LayoutSettings {
  const boot = useBootstrap();
  const layout = boot.settings.layout;
  const fit = boot.device?.fit;
  const scale = boot.device?.scale;
  return useMemo(() => resolveLayout(layout, { fit, scale }, urlLayout), [layout, fit, scale]);
}
