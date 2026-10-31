/** Real integrations, one per workstream, each in its own file or folder here. */
import type { ProviderContext, Providers } from '../types.js';
import { realCalendar } from './calendar/index.js';
import { realHome } from './home.js';
import { realLists } from './lists.js';
import { realPhotos } from './photos.js';
import { realWeather } from './weather.js';
import { loadWs4Env } from './weather-env.js';

export function realProviders(ctx: ProviderContext): Providers {
  const ws4 = loadWs4Env();
  return {
    calendar: realCalendar(ctx),
    weather: realWeather(ctx, { env: ws4 }),
    photos: realPhotos(ctx, { env: ws4 }),
    home: realHome(ctx),
    lists: realLists(ctx),
  };
}
