import { z } from 'zod';

/**
 * Environment for the WS4 integrations (weather, commute, photos). Parsed here rather than in
 * `config.ts` so each workstream's variables stay in its own files. Keep `.env.example` in step.
 */
const Ws4Env = z.object({
  /** Google Maps Platform key with the Routes API enabled. Unset: no leave-by chips. */
  GOOGLE_ROUTES_API_KEY: z.string().optional(),
  /** Key for the Google Pollen API, used where Open-Meteo has no pollen (outside Europe). Defaults to the Routes key. */
  GOOGLE_POLLEN_API_KEY: z.string().optional(),
  /** Public iCloud Shared Album link, `https://www.icloud.com/sharedalbum/#B0aGW...`. Unset: no photos. */
  ICLOUD_SHARED_ALBUM_URL: z.string().optional(),
  /** Free OpenRouteService key: used for leave-by times when there is no Google key. */
  OPENROUTESERVICE_API_KEY: z.string().optional(),
  /** OSRM server for leave-by times when neither key is set; the public demo server by default. */
  OSRM_BASE_URL: z.url().default('https://router.project-osrm.org'),
  /** Nominatim server that turns destination addresses into coordinates for OSRM and OpenRouteService. */
  NOMINATIM_BASE_URL: z.url().default('https://nominatim.openstreetmap.org'),
  /** Contact (email or URL) for the NWS and Nominatim User-Agents; the repo when unset. */
  NWS_CONTACT: z.string().default('https://github.com/sorel123/mantel'),
  /** Most photos to keep from the album, newest first. */
  PHOTO_LIMIT: z.coerce.number().int().positive().default(500),
  /**
   * Optional. With a Claude API key the weather quip is written fresh each day from the forecast
   * and the day's events (model `claude-haiku-5-5`); without one the hand-written library is used.
   */
  CLAUDE_API_KEY: z.string().optional(),
});

export type Ws4Env = z.infer<typeof Ws4Env>;

export function loadWs4Env(env: NodeJS.ProcessEnv = process.env): Ws4Env {
  // Empty strings from a copied `.env.example` mean "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  return Ws4Env.parse(cleaned);
}
