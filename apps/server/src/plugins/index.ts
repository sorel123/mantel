/**
 * The built-in plugins and the providers they drive. `createPlugins` returns both so `app.ts`
 * can hand the live providers to the routes and the plugins to the registry.
 */
import type { ProviderContext, Providers } from '../providers/types.js';
import { realLists } from '../providers/real/lists.js';
import type { RealHome } from '../providers/real/home.js';
import { haTodoPlugin } from './ha-todo/index.js';
import { RemindersBridge, remindersPlugin } from './reminders/index.js';
import { todoistPlugin } from './todoist/index.js';
import { CalendarService } from './calendar-service.js';
import { googlePlugin } from './google/index.js';
import { homeAssistantPlugin } from './homeassistant/index.js';
import { icalPlugin } from './ical/index.js';
import { icloudPlugin } from './icloud/index.js';
import { mealsPlugin } from './meals/index.js';
import { photosPlugin } from './photos/index.js';
import { photoFolderPlugin } from './photo-folder/index.js';
import { immichPlugin } from './immich/index.js';
import { googlePhotosPlugin } from './google-photos/index.js';
import { PhotoMixer } from '../providers/real/photos-mixer.js';
import { pollenPlugin } from './pollen/index.js';
import { quipsPlugin } from './quips/index.js';
import { routesPlugin } from './routes/index.js';
import { timersPlugin } from './timers/index.js';
import { mockTrashConfig, trashPlugin } from './trash/index.js';
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
  // v4 S: every photo source feeds one mixer, which is what the photo routes talk to.
  const immich = immichPlugin(opts.fetch ? { fetch: opts.fetch } : {});
  const googlePhotos = googlePhotosPlugin(opts.fetch ? { fetch: opts.fetch } : {});
  const photoFolder = photoFolderPlugin();
  const photoSources = [photos.source, immich.source, googlePhotos.source, photoFolder.source];
  const mixer = Object.assign(
    new PhotoMixer({
      sources: () => photoSources,
      settings: () => ctx.settings().photos,
      timezone: () => ctx.settings().timezone,
      now: ctx.now,
    }),
    { picker: googlePhotos.picker },
  );
  // v4 L: lists shared with Reminders (Mac helper), Todoist and Home Assistant to-do lists.
  const lists = realLists(ctx);
  const reminders = new RemindersBridge(ctx.db, lists.store, lists.sync, ctx.now);
  lists.sync.reminders = reminders;
  const plugins: Plugin[] = [
    googlePlugin(calendar),
    icalPlugin(calendar, opts.fetch),
    icloudPlugin(calendar, opts.fetch),
    home,
    photos,
    immich,
    googlePhotos,
    photoFolder,
    routesPlugin(weather, opts.fetch),
    pollenPlugin(weather, opts.fetch),
    weatherPlugin(weather, opts.fetch),
    quipsPlugin(opts.fetch),
    mealsPlugin(),
    remindersPlugin(lists.sync, reminders),
    todoistPlugin(lists.sync, opts.fetch),
    haTodoPlugin(lists.sync, () => (home.live.current() as RealHome).client ?? null),
    ...localPlugins(),
  ];
  return {
    plugins,
    calendar,
    providers: {
      calendar: calendar.live.proxy,
      weather: weather.live.proxy,
      photos: mixer,
      home: home.live.proxy,
      lists,
    },
  };
}

/**
 * Plugins that need no outside service (trash day, kitchen timers). They run for real in mock
 * mode too; mock mode gives trash a sample schedule until one is saved.
 */
export function localPlugins(opts: { mock?: boolean } = {}): Plugin[] {
  return [trashPlugin(opts.mock ? { fallback: mockTrashConfig } : {}), timersPlugin()];
}

/** Every built-in manifest, for the mock registry and for tests. */
export { manifest as googleManifest } from './google/manifest.js';
export { manifest as icloudManifest } from './icloud/manifest.js';
export { manifest as icalManifest } from './ical/manifest.js';
export { manifest as homeAssistantManifest } from './homeassistant/manifest.js';
export { manifest as photosManifest } from './photos/manifest.js';
export { manifest as immichManifest } from './immich/manifest.js';
export { manifest as googlePhotosManifest } from './google-photos/manifest.js';
export { manifest as photoFolderManifest } from './photo-folder/manifest.js';
export { manifest as routesManifest } from './routes/manifest.js';
export { manifest as pollenManifest } from './pollen/manifest.js';
export { manifest as weatherManifest } from './weather/manifest.js';
export { manifest as quipsManifest } from './quips/manifest.js';
export { manifest as mealsManifest } from './meals/manifest.js';
export { manifest as trashManifest } from './trash/manifest.js';
export { manifest as timersManifest } from './timers/manifest.js';
export { manifest as remindersManifest } from './reminders/manifest.js';
export { manifest as todoistManifest } from './todoist/manifest.js';
export { manifest as haTodoManifest } from './ha-todo/manifest.js';
