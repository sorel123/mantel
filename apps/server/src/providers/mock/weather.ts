import { commute, weather } from '@mantel/shared/fixtures';
import type { ProviderContext, WeatherProvider } from '../types.js';

export function mockWeather(ctx: ProviderContext): WeatherProvider {
  return {
    async weather() {
      return weather(ctx.now());
    },
    async commute() {
      // Mock mode always shows the chips so the leave-by UI can be built at any hour.
      return commute(ctx.now(), { force: true });
    },
  };
}
