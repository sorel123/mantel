import { describe, expect, it } from 'vitest';
import { settings } from './fixtures/settings.js';
import { clockMinutes, crossed, inWindow, minutesInZone, scheduleStateAt } from './schedule.js';

const schedule = settings().schedule; // ambient 21:00, off 23:00 to 06:00, steps 06/08/19/21
const at = (t: string) => clockMinutes(t);

describe('screen schedule', () => {
  it('handles windows that wrap past midnight', () => {
    expect(inWindow(at('23:30'), '23:00', '06:00')).toBe(true);
    expect(inWindow(at('05:59'), '23:00', '06:00')).toBe(true);
    expect(inWindow(at('06:00'), '23:00', '06:00')).toBe(false);
    expect(inWindow(at('12:00'), '23:00', '06:00')).toBe(false);
    expect(inWindow(at('12:00'), '09:00', '17:00')).toBe(true);
    expect(inWindow(at('12:00'), '09:00', '09:00')).toBe(false);
  });

  it('turns the screen off overnight and dims through the day', () => {
    expect(scheduleStateAt(schedule, at('02:00'))).toEqual({
      screen: 'off',
      ambient: false,
      brightness: 0,
    });
    expect(scheduleStateAt(schedule, at('06:30'))).toEqual({
      screen: 'on',
      ambient: false,
      brightness: 60,
    });
    expect(scheduleStateAt(schedule, at('12:00')).brightness).toBe(100);
    expect(scheduleStateAt(schedule, at('22:00'))).toEqual({
      screen: 'on',
      ambient: true,
      brightness: 35,
    });
  });

  it('uses the last step of the previous day before the first step', () => {
    const s = { ...schedule, offFrom: '00:00', onAt: '00:00' };
    expect(scheduleStateAt(s, at('03:00')).brightness).toBe(35);
  });

  it('detects boundaries crossed between ticks, including midnight', () => {
    expect(crossed(at('03:59'), at('04:00'), '04:00')).toBe(true);
    expect(crossed(at('04:00'), at('04:01'), '04:00')).toBe(false);
    expect(crossed(at('23:59'), at('00:00'), '00:00')).toBe(true);
    expect(crossed(at('23:58'), at('00:01'), '23:59')).toBe(true);
    expect(crossed(at('10:00'), at('10:00'), '10:00')).toBe(false);
  });

  it('reads the clock in the household timezone', () => {
    const d = new Date('2026-10-31T15:30:00Z');
    expect(minutesInZone(d, 'America/Los_Angeles')).toBe(at('08:30'));
    expect(minutesInZone(d, 'UTC')).toBe(at('15:30'));
    expect(minutesInZone(new Date('2026-10-31T07:05:00Z'), 'America/Los_Angeles')).toBe(
      at('00:05'),
    );
  });
});
