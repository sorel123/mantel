import { useCallback, useEffect, useRef } from 'react';

const EVENTS: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/**
 * Calls `onIdle` after `ms` without a touch, key or scroll anywhere on the page. Re-arms on every
 * interaction while `enabled`. Returns `touch()` to reset by hand (for example after a server event).
 */
export function useIdle(ms: number, onIdle: () => void, enabled = true): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cb = useRef(onIdle);
  cb.current = onIdle;

  const arm = useCallback(() => {
    clearTimeout(timer.current);
    if (!enabled || ms <= 0) return;
    timer.current = setTimeout(() => cb.current(), ms);
  }, [ms, enabled]);

  useEffect(() => {
    arm();
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    EVENTS.forEach((ev) => document.addEventListener(ev, arm, opts));
    return () => {
      clearTimeout(timer.current);
      EVENTS.forEach((ev) => document.removeEventListener(ev, arm, opts));
    };
  }, [arm]);

  return arm;
}
