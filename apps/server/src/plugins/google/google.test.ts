import { PluginManifest } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { googleRedirect } from '../../providers/real/calendar/urls.js';
import type { CalendarService } from '../calendar-service.js';
import { googlePlugin } from './index.js';
import { googleManifest, manifest } from './manifest.js';
import { sharedGoogleClient } from './shared-client.js';

const shared = { clientId: 'mantel.apps.googleusercontent.com', clientSecret: 'public-ish' };

function fakeService() {
  const applied: Array<Record<string, string | undefined>> = [];
  const service = {
    setGoogle: (v: Record<string, string | undefined>) => applied.push(v),
    current: () => null,
  } as unknown as CalendarService;
  return { service, applied };
}

describe('Google sign-in with the shared Mantel client', () => {
  it('reads the client from the environment, or not at all', () => {
    expect(sharedGoogleClient({})).toBeNull();
    expect(
      sharedGoogleClient({
        MANTEL_GOOGLE_CLIENT_ID: shared.clientId,
        MANTEL_GOOGLE_CLIENT_SECRET: shared.clientSecret,
      }),
    ).toEqual(shared);
  });

  it('moves the client fields under Advanced and makes them optional', () => {
    const m = googleManifest(true);
    expect(PluginManifest.safeParse(m).success).toBe(true);
    const f = (k: string) => m.fields.find((x) => x.key === k)!;
    expect(f('clientId')).toMatchObject({ required: false, advanced: true });
    expect(f('clientSecret')).toMatchObject({ required: false, advanced: true });
    expect(m.directions[0]).toMatch(/Press Connect/);
    expect(googleManifest(false)).toBe(manifest);
  });

  it('uses the shared client with a loopback redirect, unless the household has its own', () => {
    const { service, applied } = fakeService();
    const plugin = googlePlugin(service, shared);
    plugin.apply({}, {});
    expect(applied.at(-1)).toMatchObject({
      GOOGLE_CLIENT_ID: shared.clientId,
      GOOGLE_CLIENT_SECRET: shared.clientSecret,
      GOOGLE_LOOPBACK: '1',
    });
    plugin.apply({ clientId: 'own.apps.googleusercontent.com' }, { clientSecret: 'mine' });
    expect(applied.at(-1)).toMatchObject({
      GOOGLE_CLIENT_ID: 'own.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'mine',
      GOOGLE_LOOPBACK: undefined,
    });
  });

  it('says Connect is ready with nothing filled in', async () => {
    const { service } = fakeService();
    const withShared = googlePlugin(service, shared);
    const without = googlePlugin(service, null);
    // test() asks the service for the provider first; give it one that is not connected.
    const svc = service as unknown as { current: () => unknown };
    svc.current = () => ({ googleAuth: { connected: () => false } });
    expect((await withShared.test!({}, {})).ok).toBe(true);
    expect((await without.test!({}, {})).ok).toBe(false);
  });

  it('sends the shared client back to 127.0.0.1, with paste-back off the server', () => {
    const env = { GOOGLE_LOOPBACK: '1' as const } as Parameters<typeof googleRedirect>[0];
    expect(googleRedirect(env, { PUBLIC_URL: 'http://192.168.0.100:8787', PORT: 8787 })).toEqual({
      uri: 'http://127.0.0.1:8787/api/calendar/google/callback',
      pasteBack: true,
    });
    expect(googleRedirect(env, { PUBLIC_URL: 'http://localhost:8787', PORT: 8787 })).toEqual({
      uri: 'http://localhost:8787/api/calendar/google/callback',
      pasteBack: false,
    });
    // Even with an https address: a Desktop client can't redirect there.
    expect(googleRedirect(env, { PUBLIC_URL: 'https://mantel.example.com', PORT: 8787 }).uri).toBe(
      'http://127.0.0.1:8787/api/calendar/google/callback',
    );
  });
});
