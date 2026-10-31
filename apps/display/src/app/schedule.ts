import type { ScreenSchedule } from '@mantel/shared';

/**
 * The display's day, from the server's screen schedule:
 *  - `on`: normal; Ambient after `idleSeconds` without a touch, a tap brings the screens back.
 *  - `ambient`: from `ambientFrom`; idle goes to Ambient and a tap wakes it only until the next idle.
 *  - `off`: from `offFrom` to `onAt`; the screen is black, a tap wakes it briefly.
 * Brightness is the most recent step at or before now (wrapping to the last step of the day).
 */
export type Phase = 'on' | 'ambient' | 'off';

export interface ScheduleState {
  phase: Phase;
  /** 0-100 */
  brightness: number;
}

/** Minutes since local midnight for `HH:MM`. */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const nowMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** True when `m` lies in the window [from, to) on a 24 h clock, which may wrap midnight. */
export function inWindow(m: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export function phaseAt(schedule: ScreenSchedule, now: Date): Phase {
  const m = nowMinutes(now);
  const off = minutesOf(schedule.offFrom);
  const on = minutesOf(schedule.onAt);
  const amb = minutesOf(schedule.ambientFrom);
  if (inWindow(m, off, on)) return 'off';
  if (inWindow(m, amb, off)) return 'ambient';
  return 'on';
}

export function brightnessAt(schedule: ScreenSchedule, now: Date): number {
  const steps = [...schedule.brightness].sort((a, b) => minutesOf(a.at) - minutesOf(b.at));
  if (steps.length === 0) return 100;
  const m = nowMinutes(now);
  let current = steps[steps.length - 1]!;
  for (const s of steps) if (minutesOf(s.at) <= m) current = s;
  return Math.max(0, Math.min(100, current.level));
}

export function scheduleAt(schedule: ScreenSchedule, now: Date): ScheduleState {
  return { phase: phaseAt(schedule, now), brightness: brightnessAt(schedule, now) };
}

/** Milliseconds until the next whole minute, for schedulers that re-evaluate on the minute. */
export const msToNextMinute = (now: Date) =>
  60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
