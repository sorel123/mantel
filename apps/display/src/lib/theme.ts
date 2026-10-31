import type { ThemeMode } from '@mantel/shared';
import { useEffect } from 'react';

export type Mode = 'daylight' | 'dusk';

/** Auto picks Dusk from 7 pm to 6 am, as in the mockup. WS1 may refine this with sunrise and sunset. */
export function resolveMode(theme: ThemeMode, now = new Date()): Mode {
  if (theme !== 'auto') return theme;
  const h = now.getHours();
  return h >= 19 || h < 6 ? 'dusk' : 'daylight';
}

export function useThemeMode(theme: ThemeMode) {
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.mode = resolveMode(theme));
    apply();
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [theme]);
}
