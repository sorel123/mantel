import type { Config } from '../../../config.js';
import type { CalendarEnv } from './env.js';

/** Where Google sends the browser back after consent. */
export function googleRedirect(env: CalendarEnv, config: Pick<Config, 'PUBLIC_URL' | 'PORT'>) {
  const path = '/api/calendar/google/callback';
  const pub = new URL(config.PUBLIC_URL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(pub.hostname);
  // Mantel's shared Desktop client only takes loopback addresses (any port, no registration).
  if (env.GOOGLE_LOOPBACK)
    return local
      ? { uri: `${pub.origin}${path}`, pasteBack: false }
      : { uri: `http://127.0.0.1:${config.PORT}${path}`, pasteBack: true };
  if (env.GOOGLE_REDIRECT_URI) return { uri: env.GOOGLE_REDIRECT_URI, pasteBack: false };
  // Google only accepts https redirects, or plain http to localhost.
  if (pub.protocol === 'https:' || local) return { uri: `${pub.origin}${path}`, pasteBack: false };
  return { uri: `http://localhost:${config.PORT}${path}`, pasteBack: true };
}

/** Push needs an https address Google can reach. */
export function pushAddress(config: Pick<Config, 'PUBLIC_URL'>): string | null {
  const pub = new URL(config.PUBLIC_URL);
  if (pub.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(pub.hostname)) return null;
  return `${pub.origin}/api/calendar/google/push`;
}
