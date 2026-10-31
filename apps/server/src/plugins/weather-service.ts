/**
 * One weather provider (forecast, pollen, leave-by times) serves three plugins: weather,
 * pollen and routes. Each hands its values here; the provider is rebuilt when they change.
 */
import { HttpError } from '../errors.js';
import { loadWs4Env } from '../providers/real/weather-env.js';
import { realWeather } from '../providers/real/weather.js';
import type { ProviderContext, WeatherProvider } from '../providers/types.js';
import { live, type Live } from './live.js';

const notReady = () => Promise.reject(new HttpError('internal', 'weather provider is starting'));
const placeholder: WeatherProvider = {
  weather: notReady,
  place: notReady,
  search: notReady,
  quip: notReady,
  commute: notReady,
};

export class WeatherService {
  readonly live: Live<WeatherProvider> = live(placeholder);
  private instance: (WeatherProvider & { stop(): void }) | null = null;
  private slices: Record<string, Record<string, string | undefined>> = {};
  private builtFrom = '';
  private ctx: ProviderContext | null = null;

  constructor(private readonly opts: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {}

  attach(ctx: ProviderContext) {
    this.ctx = ctx;
  }

  /** Env-shaped values from one plugin (`GOOGLE_ROUTES_API_KEY`...). */
  set(plugin: string, values: Record<string, string | undefined>) {
    this.slices[plugin] = values;
    this.rebuild();
  }

  /** The env record the provider was built from (for status summaries). */
  envRecord(): NodeJS.ProcessEnv {
    const base = this.opts.env ?? process.env;
    const out: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(base)) if (v && k.startsWith('WEATHER_')) out[k] = v;
    for (const slice of Object.values(this.slices))
      for (const [k, v] of Object.entries(slice)) if (v) out[k] = v;
    return out;
  }

  private rebuild() {
    if (!this.ctx) return;
    const envRecord = this.envRecord();
    const key = JSON.stringify(envRecord);
    if (this.instance && key === this.builtFrom) return;
    this.builtFrom = key;
    this.instance?.stop();
    this.instance = realWeather(this.ctx, {
      env: loadWs4Env(envRecord),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    this.live.set(this.instance);
  }

  stop() {
    this.instance?.stop();
  }
}
