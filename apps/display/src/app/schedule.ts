import {
  brightnessAt as sharedBrightnessAt,
  clockMinutes,
  scheduleStateAt,
  type ScreenSchedule,
} from '@mantel/shared';

/**
 * The display's day, from the server's screen schedule (the maths lives in
 * `@mantel/shared/schedule`, which the server's `/display/state` uses too):
 *  - `on`: normal; Ambient after `idleSeconds` without a touch, a tap brings the screens back.
 *  - `ambient`: from `ambientFrom`; idle goes to Ambient and a tap wakes it only until the next idle.
 *  - `off`: from `offFrom` to `onAt`; the screen is black, a tap wakes it briefly.
 */
export type Phase = 'on' | 'ambient' | 'off';

export interface ScheduleState {
  phase: Phase;
  /** 0-100; the step in force even while the screen is off, so a wake tap is not blinding. */
  brightness: number;
}

export const minutesOf = clockMinutes;
const localMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function phaseAt(schedule: ScreenSchedule, now: Date): Phase {
  const s = scheduleStateAt(schedule, localMinutes(now));
  return s.screen === 'off' ? 'off' : s.ambient ? 'ambient' : 'on';
}

export function brightnessAt(schedule: ScreenSchedule, now: Date): number {
  return Math.max(0, Math.min(100, sharedBrightnessAt(schedule, localMinutes(now))));
}

export function scheduleAt(schedule: ScreenSchedule, now: Date): ScheduleState {
  return { phase: phaseAt(schedule, now), brightness: brightnessAt(schedule, now) };
}

/** Milliseconds until the next whole minute, for schedulers that re-evaluate on the minute. */
export const msToNextMinute = (now: Date) =>
  60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
