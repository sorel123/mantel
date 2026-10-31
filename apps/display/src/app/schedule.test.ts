import { settings } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { brightnessAt, phaseAt, scheduleAt } from './schedule';

const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
const schedule = settings().schedule; // ambient 21:00, off 23:00-06:00, brightness 06/08/19/21

describe('schedule', () => {
  it('is on during the day, ambient in the evening and off overnight', () => {
    expect(phaseAt(schedule, at(9))).toBe('on');
    expect(phaseAt(schedule, at(20, 59))).toBe('on');
    expect(phaseAt(schedule, at(21))).toBe('ambient');
    expect(phaseAt(schedule, at(22, 30))).toBe('ambient');
    expect(phaseAt(schedule, at(23))).toBe('off');
    expect(phaseAt(schedule, at(3))).toBe('off');
    expect(phaseAt(schedule, at(5, 59))).toBe('off');
    expect(phaseAt(schedule, at(6))).toBe('on');
  });

  it('uses the most recent brightness step, wrapping to the last step before the first', () => {
    expect(brightnessAt(schedule, at(6))).toBe(60);
    expect(brightnessAt(schedule, at(7, 59))).toBe(60);
    expect(brightnessAt(schedule, at(8))).toBe(100);
    expect(brightnessAt(schedule, at(12))).toBe(100);
    expect(brightnessAt(schedule, at(19))).toBe(70);
    expect(brightnessAt(schedule, at(22))).toBe(35);
    expect(brightnessAt(schedule, at(1))).toBe(35);
  });

  it('defaults to full brightness with no steps', () => {
    expect(brightnessAt({ ...schedule, brightness: [] }, at(12))).toBe(100);
  });

  it('combines both', () => {
    expect(scheduleAt(schedule, at(21, 30))).toEqual({ phase: 'ambient', brightness: 35 });
  });
});
