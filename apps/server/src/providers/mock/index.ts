import type { ProviderContext, Providers } from '../types.js';
import { mockCalendar } from './calendar.js';
import { mockHome } from './home.js';
import { mockLists } from './lists.js';
import { mockPhotos } from './photos.js';
import { mockWeather } from './weather.js';

export function mockProviders(ctx: ProviderContext): Providers {
  return {
    calendar: mockCalendar(ctx),
    weather: mockWeather(ctx),
    photos: mockPhotos(),
    home: mockHome(ctx),
    lists: mockLists(ctx),
  };
}
