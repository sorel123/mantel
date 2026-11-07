import { describe, expect, it } from 'vitest';
import { trashAmbient, trashCard } from './index.js';
import { holidays, momentAt, pickups, scheduleFrom, streamNames } from './schedule.js';

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h);
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('trash schedule', () => {
  const weekly = scheduleFrom({
    trashDay: 'thursday',
    recyclingDay: 'thursday',
    recyclingEvery: 'biweekly',
    recyclingSince: '2026-11-05',
    yardDay: 'none',
  });

  it('reads streams from the settings and skips the ones with no day', () => {
    expect(weekly.streams.map((s) => s.id)).toEqual(['trash', 'recycling']);
    expect(weekly.remindFrom).toBe(16);
    expect(scheduleFrom({}).streams).toEqual([]);
  });

  it('puts every-other-week pickups on the right weeks', () => {
    const list = pickups(weekly, at(2026, 11, 2), 21);
    const recycling = list.filter((p) => p.stream === 'recycling').map((p) => ymd(p.date));
    const trash = list.filter((p) => p.stream === 'trash').map((p) => ymd(p.date));
    expect(trash).toEqual(['2026-11-5', '2026-11-12', '2026-11-19']);
    expect(recycling).toEqual(['2026-11-5', '2026-11-19']);
  });

  it('knows the holidays haulers observe', () => {
    expect(holidays(2026).map(ymd)).toEqual([
      '2026-1-1',
      '2026-5-25',
      '2026-7-4',
      '2026-9-7',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  it('slides pickup a day after a holiday earlier in the week, when asked', () => {
    // Thanksgiving 2026 is Thursday 26 November: Thursday pickup moves to Friday.
    const shifted = scheduleFrom({ trashDay: 'thursday', holidayShift: true });
    const p = pickups(shifted, at(2026, 11, 23), 6).find((x) => x.stream === 'trash')!;
    expect(ymd(p.date)).toBe('2026-11-27');
    expect(p.shifted).toBe(true);
    // Labor Day (Monday 7 September) moves a Wednesday pickup to Thursday.
    const wed = scheduleFrom({ trashDay: 'wednesday', holidayShift: true });
    expect(ymd(pickups(wed, at(2026, 9, 7), 6)[0]!.date)).toBe('2026-9-10');
    // Without the switch nothing moves.
    const plain = scheduleFrom({ trashDay: 'thursday' });
    expect(ymd(pickups(plain, at(2026, 11, 23), 6)[0]!.date)).toBe('2026-11-26');
    // A Saturday holiday (July 4, 2026) moves nothing.
    const fri = scheduleFrom({ trashDay: 'friday', holidayShift: true });
    expect(ymd(pickups(fri, at(2026, 6, 29), 6)[0]!.date)).toBe('2026-7-3');
  });

  it('reminds the evening before and the morning of, and is quiet otherwise', () => {
    expect(momentAt(weekly, at(2026, 11, 4, 15)).kind).toBe('quiet');
    const tonight = momentAt(weekly, at(2026, 11, 4, 18));
    expect(tonight).toMatchObject({ kind: 'tonight', streams: ['trash', 'recycling'] });
    expect(momentAt(weekly, at(2026, 11, 5, 7))).toMatchObject({ kind: 'today' });
    expect(momentAt(weekly, at(2026, 11, 5, 13)).kind).toBe('quiet');
    // An off week for recycling reminds about trash only.
    expect(momentAt(weekly, at(2026, 11, 11, 20))).toMatchObject({ streams: ['trash'] });
  });

  it('names the bins the way people say them', () => {
    expect(streamNames(['trash'])).toBe('Trash');
    expect(streamNames(['trash', 'recycling'])).toBe('Trash and recycling');
    expect(streamNames(['trash', 'recycling', 'yard'])).toBe('Trash, recycling and yard waste');
  });
});

describe('trash blocks', () => {
  const s = scheduleFrom({ trashDay: 'thursday', recyclingDay: 'thursday', yardDay: 'monday' });

  it('says "tonight" the evening before, with the other bins after', () => {
    const card = trashCard(s, at(2026, 11, 4, 19));
    expect(card.title).toBe('Trash and recycling tonight');
    expect(card.lines!.map((l) => [l.text, l.tone ?? 'normal'])).toEqual([
      ['Trash', 'warn'],
      ['Recycling', 'warn'],
      ['Yard waste', 'normal'],
    ]);
    expect(trashAmbient(s, at(2026, 11, 4, 19))?.title).toBe('Trash and recycling tonight');
  });

  it('says "out today" until noon on pickup day', () => {
    expect(trashCard(s, at(2026, 11, 5, 8)).title).toBe('Trash and recycling out today');
  });

  it('lists the next pickup of each bin the rest of the time', () => {
    const card = trashCard(s, at(2026, 11, 5, 14));
    expect(card.title).toBe('Trash and recycling');
    expect(card.lines!.map((l) => `${l.text}: ${l.sub}`)).toEqual([
      'Yard waste: Monday · in 4 days',
      'Trash: Thu, Nov 12 · in 7 days',
      'Recycling: Thu, Nov 12 · in 7 days',
    ]);
    expect(trashAmbient(s, at(2026, 11, 5, 14))).toBeNull();
  });

  it('asks for a schedule when there is none', () => {
    expect(trashCard(scheduleFrom({}), at(2026, 11, 5)).empty).toMatch(/Settings/);
  });
});
