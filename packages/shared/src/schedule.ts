/**
 * The screen schedule as pure functions, so the server, the display and tests agree on
 * what "now" means. Clock times are `HH:MM` in the household timezone; windows may wrap
 * past midnight (`offFrom: '23:00'`, `onAt: '06:00'`).
 */
import type { ScreenSchedule } from './models.js';

export const DEFAULT_RELOAD_AT = '04:00';
const DAY = 24 * 60;

/** Minutes after midnight for `HH:MM`. */
export function clockMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes after midnight for `d` in `timeZone` (an IANA name such as `America/Los_Angeles`). */
export function minutesInZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/** True when `now` is in `[from, to)`, wrapping past midnight. An empty window (`from === to`) is never on. */
export function inWindow(now: number, from: string, to: string): boolean {
  const a = clockMinutes(from);
  const b = clockMinutes(to);
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

/** True when the clock moved past `at` going from `prev` to `now` (exclusive, inclusive), wrapping at midnight. */
export function crossed(prev: number, now: number, at: string): boolean {
  const t = clockMinutes(at);
  if (prev === now) return false;
  return prev < now ? t > prev && t <= now : t > prev || t <= now;
}

/** The brightness step in force: the latest at or before `now`, else the last step of the day before. */
export function brightnessAt(schedule: Pick<ScreenSchedule, 'brightness'>, now: number): number {
  const steps = [...schedule.brightness].sort((x, y) => clockMinutes(x.at) - clockMinutes(y.at));
  if (steps.length === 0) return 100;
  const current = steps.filter((s) => clockMinutes(s.at) <= now % DAY).pop();
  return (current ?? steps[steps.length - 1]!).level;
}

export interface ScheduleState {
  screen: 'on' | 'off';
  ambient: boolean;
  brightness: number;
}

/** What the screen should do at `now` minutes after midnight. */
export function scheduleStateAt(schedule: ScreenSchedule, now: number): ScheduleState {
  if (inWindow(now, schedule.offFrom, schedule.onAt))
    return { screen: 'off', ambient: false, brightness: 0 };
  return {
    screen: 'on',
    ambient: inWindow(now, schedule.ambientFrom, schedule.offFrom),
    brightness: brightnessAt(schedule, now),
  };
}
