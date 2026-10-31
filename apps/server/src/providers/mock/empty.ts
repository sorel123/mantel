/**
 * `MOCK=1 MOCK_EMPTY=1`: the fixture providers, but answering as a fresh install with nothing
 * connected would, so the display's empty states can be seen and tested without any account.
 * Calendars and lists come back empty; weather and Home Assistant answer 501 as the real
 * providers do before they are set up; the album has no photos.
 */
import { HttpError } from '../../errors.js';
import type { Providers } from '../types.js';

const notSetUp = (what: string) => Promise.reject(new HttpError('not_implemented', what));

export function emptyProviders(base: Providers): Providers {
  return {
    calendar: {
      ...base.calendar,
      events: async () => ({ events: [] }),
      countdowns: async () => ({ countdowns: [] }),
      meals: async (week) => ({ ...(await base.calendar.meals(week)), meals: [] }),
      calendars: async () => [],
    },
    weather: {
      weather: () => notSetUp('Weather needs a home location in Settings'),
      place: () => notSetUp('Weather needs a home location in Settings'),
      search: async () => ({ places: [] }),
      quip: async () => ({ quip: null }),
      commute: async () => ({ leaveBy: [] }),
    },
    photos: { ...base.photos, next: async () => ({ photos: [] }) },
    home: {
      ...base.home,
      state: () => notSetUp('Home Assistant is not connected yet'),
      media: async () => ({ players: [] }),
    },
    lists: {
      ...base.lists,
      lists: async () => ({ lists: [] }),
      chores: async () => ({ ...(await base.lists.chores()), chores: [], stars: [] }),
    },
  };
}
