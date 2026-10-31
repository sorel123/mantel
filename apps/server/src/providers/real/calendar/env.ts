import { z } from 'zod';

/**
 * Calendar settings from the environment. Kept here rather than in `config.ts` so WS2 stays
 * inside its own folder; `.env.example` lists every variable.
 */
const CalendarEnv = z.object({
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * Overrides the OAuth redirect URI. Defaults to `${PUBLIC_URL}/api/calendar/google/callback`
   * when PUBLIC_URL is https or localhost, else `http://localhost:${PORT}/...` with paste-back.
   */
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  ICLOUD_USERNAME: z.string().optional(),
  ICLOUD_APP_PASSWORD: z.string().optional(),
  ICLOUD_CALDAV_URL: z.string().url().default('https://caldav.icloud.com/'),
  /** Seconds between syncs. Push-enabled Google calendars use the slower safety-net interval. */
  CALENDAR_POLL_SECONDS: z.coerce.number().int().min(30).default(180),
  CALENDAR_PUSH_POLL_SECONDS: z.coerce.number().int().min(60).default(900),
  /** Days of history and future kept in the local cache. */
  CALENDAR_PAST_DAYS: z.coerce.number().int().min(7).default(62),
  CALENDAR_FUTURE_DAYS: z.coerce.number().int().min(14).default(366),
});

export type CalendarEnv = z.infer<typeof CalendarEnv>;

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function loadCalendarEnv(env: NodeJS.ProcessEnv = process.env): CalendarEnv {
  const raw = Object.fromEntries(
    Object.keys(CalendarEnv.shape).map((k) => [k, blank(env[k])]),
  ) as Record<string, string | undefined>;
  return CalendarEnv.parse(raw);
}
