import type { ThemeMode } from '@mantel/shared';
import { useEffect, useSyncExternalStore } from 'react';

export type Mode = 'daylight' | 'dusk';

/** Sunrise and sunset as ISO strings; WS4's weather feature publishes them with `setSunTimes`. */
export interface SunTimes {
  sunrise: string;
  sunset: string;
}

let sun: SunTimes | null = null;
let override: Mode | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Let auto mode follow the real sun instead of the 7 pm to 6 am default. */
export function setSunTimes(next: SunTimes | null) {
  sun = next;
  notify();
}

/** Force a mode regardless of settings (demo page, kiosk tools). `null` returns control to settings. */
export function setModeOverride(mode: Mode | null) {
  override = mode;
  notify();
}

/**
 * Auto picks Dusk from 7 pm to 6 am, as in the mockup, or from sunset to sunrise when the
 * weather feature has published sun times for today.
 */
export function resolveMode(
  theme: ThemeMode,
  now = new Date(),
  sunTimes: SunTimes | null = sun,
): Mode {
  if (theme !== 'auto') return theme;
  if (sunTimes) {
    const rise = new Date(sunTimes.sunrise).getTime();
    const set = new Date(sunTimes.sunset).getTime();
    if (Number.isFinite(rise) && Number.isFinite(set) && rise < set) {
      const t = now.getTime();
      // Compare on time of day so yesterday's sun times still work after midnight.
      const minutes = (d: number) => {
        const x = new Date(d);
        return x.getHours() * 60 + x.getMinutes();
      };
      const m = minutes(t);
      return m >= minutes(rise) && m < minutes(set) ? 'daylight' : 'dusk';
    }
  }
  const h = now.getHours();
  return h >= 19 || h < 6 ? 'dusk' : 'daylight';
}

export function applyMode(mode: Mode) {
  document.documentElement.dataset.mode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'dusk' ? '#101216' : '#efeee9');
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Keeps `<html data-mode>` in step with the theme setting, the clock, sun times and any override. */
export function useThemeMode(theme: ThemeMode): Mode {
  const tick = useSyncExternalStore(
    subscribe,
    () => override ?? sun,
    () => null,
  );
  const mode = override ?? resolveMode(theme, new Date(), sun);
  useEffect(() => {
    const apply = () => applyMode(override ?? resolveMode(theme, new Date(), sun));
    apply();
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [theme, tick]);
  return mode;
}
