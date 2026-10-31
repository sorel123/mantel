import { z } from 'zod';

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

/** Every environment variable the server reads. Keep `.env.example` in step with this. */
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  /** Serve fixtures for every integration instead of talking to real services. */
  MOCK: flag,
  /** With MOCK: every integration answers as if nothing were set up yet, to see the empty states. */
  MOCK_EMPTY: flag,
  /** Where SQLite and caches live. `:memory:` keeps nothing on disk. */
  DATA_DIR: z.string().default('./data'),
  /** Built display to serve at `/` (production). Unset in dev, where Vite serves it. */
  DISPLAY_DIST: z.string().optional(),
  /** Origin of the server as the tablet sees it, used for OAuth redirects. */
  PUBLIC_URL: z.string().default('http://localhost:8787'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof Env> & { isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return { ...parsed, isProd: parsed.NODE_ENV === 'production' };
}
