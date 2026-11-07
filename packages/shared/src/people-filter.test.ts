import { describe, expect, it } from 'vitest';
import {
  PERSON_FILTER_IDLE_MS,
  PERSON_FILTER_SHEET_MS,
  dimmedFor,
  forPerson,
  guestAllows,
  personFilterExpired,
  togglePerson,
} from './people-filter.js';

describe('person filter', () => {
  it('keeps the chosen person and shared things bright, dims the rest', () => {
    expect(forPerson(['ava'], null)).toBe(true);
    expect(forPerson(['ava', 'leo'], 'leo')).toBe(true);
    expect(forPerson([], 'leo')).toBe(true);
    expect(dimmedFor(['jay'], 'leo')).toBe(true);
  });
  it('toggles, expires and limits guests', () => {
    expect(togglePerson(null, 'sam')).toBe('sam');
    expect(togglePerson('sam', 'sam')).toBeNull();
    expect(personFilterExpired(0, PERSON_FILTER_IDLE_MS, false)).toBe(true);
    expect(personFilterExpired(0, PERSON_FILTER_IDLE_MS, true)).toBe(false);
    expect(personFilterExpired(0, PERSON_FILTER_SHEET_MS, true)).toBe(true);
    expect(guestAllows('month')).toBe(true);
    expect(guestAllows('home')).toBe(false);
    expect(guestAllows('lists')).toBe(false);
  });
});
