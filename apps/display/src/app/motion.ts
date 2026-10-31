import { useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';

/** The mockup's one curve and three durations, for Framer Motion. CSS uses the same values as tokens. */
export const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
export const FAST = 0.15;
export const STD = 0.32;
export const SLOW = 0.7;

export const fast = { duration: FAST, ease: EASE };
export const std = { duration: STD, ease: EASE };
export const slow = { duration: SLOW, ease: EASE };

/** Mirrors `prefers-reduced-motion` onto `<html data-motion>` so CSS and JS motion agree. */
export function useMotionPreference(): boolean {
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    if (reduced) document.documentElement.dataset.motion = 'reduced';
    else delete document.documentElement.dataset.motion;
  }, [reduced]);
  return reduced;
}

/** A transition that collapses to instant under reduced motion. */
export const motionOr = (reduced: boolean, t: { duration: number; ease: typeof EASE }) =>
  reduced ? { duration: 0 } : t;
