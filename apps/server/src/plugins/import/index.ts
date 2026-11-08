/**
 * Magic Import (v3 C): a photo of a flyer becomes calendar events, list items and meals. The
 * photo goes to Claude only when a Claude key is saved (Settings › Weather quips); nothing is
 * written until the person commits what they checked. Mock mode reads every photo as the same
 * sample flyer.
 */
import { sampleImport } from '@mantel/shared';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import { dateInZone } from '../../providers/real/weather-time.js';
import { IMPORT_MODEL, ImportError, analyseWithClaude } from './claude.js';
import type { MealsService } from '../meals/index.js';
import { commitImport } from './commit.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `meals` is the planner (v3 M): imported meals go into it while it is on. */
export function registerImportRoutes(handle: Handle, deps: AppDeps, meals?: MealsService) {
  const { config, settings, providers, registry } = deps;
  /** The Claude key saved for weather quips (a shared Claude integration can take over later). */
  const key = () => registry.resolve('quips').secrets.claudeApiKey ?? '';

  handle('importStatus', async () => {
    if (config.MOCK)
      return {
        ready: true,
        mock: true,
        model: IMPORT_MODEL,
        message: 'Mock mode: every photo reads as the same sample flyer.',
      };
    const ready = !!key();
    return {
      ready,
      mock: false,
      model: IMPORT_MODEL,
      message: ready
        ? 'Ready. Photos are sent to Anthropic to be read, then shown here to check.'
        : 'Add a Claude key in Settings › Weather quips to read photos.',
    };
  });

  handle('importAnalyse', async ({ body }) => {
    if (config.MOCK) return sampleImport(new Date());
    const apiKey = key();
    if (!apiKey)
      throw new HttpError(
        'forbidden',
        'Magic Import needs a Claude key. Add one in Settings › Weather quips.',
      );
    const s = settings.get();
    const now = new Date();
    const today = dateInZone(now, s.timezone);
    const lists = await providers.lists
      .lists()
      .then((r) => r.lists)
      .catch(() => []);
    try {
      return await analyseWithClaude({
        apiKey,
        image: body.image,
        hint: body.hint,
        today,
        weekday: WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]!,
        timeZone: s.timezone,
        people: s.people,
        lists,
      });
    } catch (err) {
      if (err instanceof ImportError) throw new HttpError('upstream_error', err.message);
      log.error('import: analyse failed', { err: String(err) });
      throw new HttpError('upstream_error', 'Could not read that photo. Try again.');
    }
  });

  handle('importCommit', async ({ body }) =>
    commitImport(body, providers, settings.get().timezone, meals),
  );
}
