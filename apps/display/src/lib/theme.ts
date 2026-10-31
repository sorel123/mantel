import {
  DEFAULT_APPEARANCE,
  FONTS,
  SKIN_TOKEN_KEYS,
  SKIN_TOKEN_VARS,
  TEXT_SCALE,
  applyOverrides,
  isDark,
  pickSkin,
  type Appearance,
  type Skin,
  type ThemeMode,
} from '@mantel/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { builtInSkins, defaultSkin, findBuiltInSkin } from '../styles/skins';

export type Mode = 'daylight' | 'dusk';

/** Sunrise and sunset as ISO strings; WS4's weather feature publishes them with `setSunTimes`. */
export interface SunTimes {
  sunrise: string;
  sunset: string;
}

let sun: SunTimes | null = null;
let override: Mode | null = null;
let appearance: Appearance = DEFAULT_APPEARANCE;
let skinOverride: string | null = null;
let currentMode: Mode = 'daylight';
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

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

/** The appearance settings from bootstrap (or a draft being edited). Applies at once. */
export function setAppearance(next: Appearance) {
  appearance = next;
  applyCurrentSkin();
  notify();
}

/** Pin a skin by id regardless of settings (`?skin=`, the gallery). `null` returns to settings. */
export function setSkinOverride(id: string | null) {
  skinOverride = id;
  applyCurrentSkin();
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

/**
 * The skin to show: a pinned one, else what the appearance names (a seasonal one when
 * "Follow the season" is on), with the accent and display-font overrides applied.
 */
export function resolveSkin(
  a: Appearance = appearance,
  pinned: string | null = skinOverride,
  date = new Date(),
): Skin {
  const base = (pinned && findBuiltInSkin(pinned)) || pickSkin(a, builtInSkins, defaultSkin, date);
  return applyOverrides(base, a);
}

let applied: { id: string; mode: Mode } | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Writes a skin to `<html>`: the thirteen colours and both fonts as inline CSS variables (which
 * win over the `tokens.css` defaults), the radius and text scales, the person palette as
 * `--pp-1` to `--pp-12`, and `data-skin`, `data-card-style` and `data-scheme` for CSS to key
 * on. A change of skin or mode sets `data-skin-fade` for 700 ms so every colour cross-fades.
 */
export function applySkin(skin: Skin, mode: Mode, a: Appearance = appearance) {
  const root = document.documentElement;
  const style = root.style;
  const tokens = skin[mode];
  for (const key of SKIN_TOKEN_KEYS) style.setProperty(SKIN_TOKEN_VARS[key], tokens[key]);
  style.setProperty('--display', FONTS[skin.fonts.display].stack);
  style.setProperty('--body', FONTS[skin.fonts.body].stack);
  style.setProperty('--radius-scale', String(skin.radii));
  style.setProperty('--text-scale', String(TEXT_SCALE[a.textSize]));
  skin.personPalette.forEach((p, i) => style.setProperty(`--pp-${i + 1}`, p.color));
  const dark = isDark(tokens.bg);
  style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.skin = skin.id;
  root.dataset.cardStyle = skin.cardStyle;
  root.dataset.type = skin.type;
  root.dataset.scheme = dark ? 'dark' : 'light';
  root.dataset.displayFont = FONTS[skin.fonts.display].kind;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tokens.bg);

  if (applied && (applied.id !== skin.id || applied.mode !== mode)) {
    root.dataset.skinFade = '';
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => delete root.dataset.skinFade, 700);
  }
  applied = { id: skin.id, mode };
}

function applyCurrentSkin() {
  if (typeof document === 'undefined') return;
  applySkin(resolveSkin(), currentMode);
}

export function applyMode(mode: Mode) {
  currentMode = mode;
  document.documentElement.dataset.mode = mode;
  applyCurrentSkin();
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
    () => version,
    () => 0,
  );
  const mode = override ?? resolveMode(theme, new Date(), sun);
  useEffect(() => {
    const apply = () => applyMode(override ?? resolveMode(theme, new Date(), sun));
    apply();
    // Also re-evaluates "Follow the season" once a minute, so a dated skin arrives at midnight.
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [theme, tick]);
  return mode;
}

/** Feeds the appearance settings into the theme while the component is mounted. */
export function useAppearance(a: Appearance | undefined) {
  useEffect(() => {
    setAppearance(a ?? DEFAULT_APPEARANCE);
  }, [a]);
}

export interface SkinState {
  skin: Skin;
  mode: Mode;
  appearance: Appearance;
}

/** The skin being shown right now, for the decor layer and the gallery. */
export function useSkin(): SkinState {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return { skin: resolveSkin(), mode: currentMode, appearance };
}
