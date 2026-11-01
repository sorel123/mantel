/**
 * Mantel's own Google sign-in: one OAuth client of the "Desktop app" type, made once by the
 * project in Google Cloud and shipped with Mantel, so a household only presses Connect and
 * signs in. No Google Cloud console, no redirect URI to copy.
 *
 * Google treats a Desktop client's secret as public (it ships inside every copy of an
 * installed app), so it can live in the source. Desktop clients accept a loopback redirect on
 * any port, which is why sign-in with this client always comes back to
 * `http://127.0.0.1:<PORT>/...`: on the computer running Mantel that lands directly; anywhere
 * else the paste-back step takes the address.
 *
 * The published Docker image sets MANTEL_GOOGLE_CLIENT_ID and MANTEL_GOOGLE_CLIENT_SECRET
 * (from the repository's Actions secrets, see the Dockerfile). BUILT_IN is the fallback for
 * builds from source and is blank, so those ask for a household's own client (the Advanced
 * fields). See docs/google-shared-client.md.
 */
const BUILT_IN = {
  clientId: '',
  clientSecret: '',
};

export interface SharedClient {
  clientId: string;
  clientSecret: string;
}

export function sharedGoogleClient(env: NodeJS.ProcessEnv = process.env): SharedClient | null {
  const clientId = env.MANTEL_GOOGLE_CLIENT_ID?.trim() || BUILT_IN.clientId;
  const clientSecret = env.MANTEL_GOOGLE_CLIENT_SECRET?.trim() || BUILT_IN.clientSecret;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
