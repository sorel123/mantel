import { placeId } from '@mantel/shared';
import {
  commute,
  weather,
  weatherForPlace,
  weatherPlaces,
  weatherQuip,
} from '@mantel/shared/fixtures';
import type { ProviderContext, WeatherProvider } from '../types.js';

export function mockWeather(ctx: ProviderContext): WeatherProvider {
  return {
    async weather() {
      return weather(ctx.now());
    },
    async place(q) {
      return weatherForPlace(ctx.now(), { latitude: q.lat, longitude: q.lon, name: q.name });
    },
    async search(q) {
      const needle = q.trim().toLowerCase();
      const hits = weatherPlaces.filter((p) =>
        `${p.name} ${p.region ?? ''} ${p.country ?? ''}`.toLowerCase().includes(needle),
      );
      // A pasted "lat, lon" pair is a place too, as on the real server.
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
      if (m) {
        const latitude = Number(m[1]);
        const longitude = Number(m[2]);
        hits.unshift({ id: placeId(latitude, longitude), name: q.trim(), latitude, longitude });
      }
      return { places: hits };
    },
    async quip() {
      return { quip: weatherQuip(ctx.now()) };
    },
    async commute() {
      // Mock mode always shows the chips so the leave-by UI can be built at any hour.
      return commute(ctx.now(), { force: true });
    },
  };
}
