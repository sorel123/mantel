/**
 * Pure maths for a light tile: what a finger is doing on it, and the brightness a horizontal
 * drag lands on. The tile itself (`Rooms.tsx`) only feeds these pointer positions.
 */

/** How far a finger may wander before a tap stops being a tap. */
export const TAP_SLOP_PX = 8;
/** A press held this long without moving opens the colour sheet. */
export const LONG_PRESS_MS = 500;
/** Brightness calls wait this long after the finger stops. */
export const DIM_DEBOUNCE_MS = 150;

export type Gesture = 'pending' | 'drag' | 'scroll';

/**
 * Decide once the finger has moved past the slop: mostly sideways dims, mostly up or down
 * scrolls the screen (and the tile lets go). Until then it may still be a tap or a long press.
 */
export function classify(dx: number, dy: number, slop = TAP_SLOP_PX): Gesture {
  if (Math.hypot(dx, dy) < slop) return 'pending';
  return Math.abs(dx) >= Math.abs(dy) ? 'drag' : 'scroll';
}

/**
 * The brightness (1 to 100) after dragging `dx` pixels across a tile `width` pixels wide,
 * starting from `start` (0 when the light was off). The fill follows the finger one to one:
 * the full width of the tile is the full range.
 */
export function dragPct(start: number, dx: number, width: number): number {
  if (!(width > 0)) return clampPct(start);
  return clampPct(start + (dx / width) * 100);
}

export const clampPct = (v: number) => Math.min(100, Math.max(1, Math.round(v)));

/** Where a light starts a drag from: its brightness when on, nothing when off. */
export const dragStart = (on: boolean, pct: number | null) => (on ? (pct ?? 100) : 0);
