import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Glance mode: for a display with no touchscreen (a Mantel OS box on a monitor or TV). Touch-only
 * controls are hidden (`html[data-glance]`, see `styles/glance.css`) and the screens rotate on
 * their own. Per display, kept in local storage; `?glance=1` turns it on, `?glance=0` off.
 */
const KEY = 'mantel.glance';

/** How long each screen stays up while rotating. */
export const GLANCE_DWELL_MS = 30_000;
/** How long a click or key press pauses the rotation. */
export const GLANCE_PAUSE_MS = 2 * 60_000;

/** The stored choice, with a `?glance=` parameter taking precedence. */
export function resolveGlance(search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get('glance');
  if (param === '1') return true;
  if (param === '0') return false;
  return stored === '1';
}

const listeners = new Set<() => void>();
let current = false;

function apply(on: boolean) {
  current = on;
  if (on) document.documentElement.dataset.glance = '';
  else delete document.documentElement.dataset.glance;
  listeners.forEach((l) => l());
}

function persist(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/** Reads the URL and local storage once at start-up; a parameter is remembered. */
export function initGlance() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: the URL parameter still works for this page load.
  }
  const on = resolveGlance(location.search, stored);
  if (on !== (stored === '1')) persist(on);
  apply(on);
}

export function setGlance(on: boolean) {
  persist(on);
  apply(on);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Whether this display is in glance mode. */
export function useGlance(): boolean {
  return useSyncExternalStore(subscribe, () => current);
}

/** The screen after `current`, wrapping; the first one when `current` is not in the list. */
export function nextScreenId(ids: string[], current: string): string | undefined {
  if (ids.length === 0) return undefined;
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}

/**
 * Moves to the next screen every `dwellMs` while `enabled`. A pointer press or key press
 * pauses it for `pauseMs`, after which the rotation carries on from where it is.
 */
export function useGlanceRotation({
  ids,
  current,
  go,
  enabled,
  dwellMs = GLANCE_DWELL_MS,
  pauseMs = GLANCE_PAUSE_MS,
}: {
  ids: string[];
  current: string;
  go: (id: string) => void;
  enabled: boolean;
  dwellMs?: number;
  pauseMs?: number;
}) {
  const goRef = useRef(go);
  goRef.current = go;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const count = ids.length;

  useEffect(() => {
    if (!enabled || count < 2) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = nextScreenId(idsRef.current, current);
        if (next) goRef.current(next);
      }, ms);
    };
    const pause = () => arm(pauseMs);
    arm(dwellMs);
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    document.addEventListener('pointerdown', pause, opts);
    document.addEventListener('keydown', pause, opts);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', pause, opts);
      document.removeEventListener('keydown', pause, opts);
    };
  }, [enabled, count, current, dwellMs, pauseMs]);
}
