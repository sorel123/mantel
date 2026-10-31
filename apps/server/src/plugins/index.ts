/**
 * The built-in plugins and the providers they drive. `createPlugins` returns both so `app.ts`
 * can hand the live providers to the routes and the plugins to the registry.
 */
import type { ProviderContext, Providers } from '../providers/types.js';
import { realLists } from '../providers/real/lists.js';
import { CalendarService } from './calendar-service.js';
import { googlePlugin } from './google/index.js';
import { homeAssistantPlugin } from './homeassistant/index.js';
import { icloudPlugin } from './icloud/index.js';
import { photosPlugin } from './photos/index.js';
import { pollenPlugin } from './pollen/index.js';
import { quipsPlugin } from './quips/index.js';
import { routesPlugin } from './routes/index.js';
import type { Plugin } from './types.js';
import { WeatherService } from './weather-service.js';
import { weatherPlugin } from './weather/index.js';

export interface PluginSet {
  plugins: Plugin[];
  providers: Providers;
  calendar: CalendarService;
}

export interface CreatePluginsOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function createPlugins(ctx: ProviderContext, opts: CreatePluginsOptions = {}): PluginSet {
  const calendar = new CalendarService(opts);
  const weather = new WeatherService(opts);
  const home = homeAssistantPlugin(opts);
  const photos = photosPlugin(opts.fetch ? { fetch: opts.fetch } : {});
  const plugins: Plugin[] = [
    googlePlugin(calendar),
    icloudPlugin(calendar, opts.fetch),
    home,
    photos,
    routesPlugin(weather, opts.fetch),
    pollenPlugin(weather, opts.fetch),
    weatherPlugin(weather, opts.fetch),
    quipsPlugin(opts.fetch),
  ];
  return {
    plugins,
    calendar,
    providers: {
      calendar: calendar.live.proxy,
      weather: weather.live.proxy,
      photos: photos.live.proxy,
      home: home.live.proxy,
      lists: realLists(ctx),
    },
  };
}

/** Every built-in manifest, for the mock registry and for tests. */
export { manifest as googleManifest } from './google/manifest.js';
export { manifest as icloudManifest } from './icloud/manifest.js';
export { manifest as homeAssistantManifest } from './homeassistant/manifest.js';
export { manifest as photosManifest } from './photos/manifest.js';
export { manifest as routesManifest } from './routes/manifest.js';
export { manifest as pollenManifest } from './pollen/manifest.js';
export { manifest as weatherManifest } from './weather/manifest.js';
export { manifest as quipsManifest } from './quips/manifest.js';
