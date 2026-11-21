import { describe, expect, it } from 'vitest';
import { UpdateChecker, isNewer } from './update.js';

describe('isNewer', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('nightly', '0.1.0')).toBe(false);
  });
});

describe('UpdateChecker', () => {
  const reply = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('reports a newer release', async () => {
    const c = new UpdateChecker({
      enabled: true,
      repo: 'a/b',
      fetch: reply(200, { tag_name: 'v9.0.0', html_url: 'https://example.test/r' }),
    });
    const r = await c.check();
    expect(r).toMatchObject({ checked: true, available: true, latest: '9.0.0' });
  });

  it('treats no release and errors as nothing to report', async () => {
    expect(
      (await new UpdateChecker({ enabled: true, repo: 'a/b', fetch: reply(404) }).check())
        .available,
    ).toBe(false);
    const boom = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(
      (await new UpdateChecker({ enabled: true, repo: 'a/b', fetch: boom }).check()).checked,
    ).toBe(false);
  });

  it('does nothing when switched off', async () => {
    const c = new UpdateChecker({
      enabled: false,
      repo: 'a/b',
      fetch: reply(200, { tag_name: 'v9.0.0' }),
    });
    expect((await c.check()).checked).toBe(false);
  });
});

describe('UpdateChecker as a snap', () => {
  it('says updates are automatic and reads the store stable version', async () => {
    const seen: string[] = [];
    const c = new UpdateChecker({
      enabled: false,
      repo: 'a/b',
      snap: { revision: '12' },
      fetch: (async (url: string) => {
        seen.push(url);
        return new Response(
          JSON.stringify({
            'channel-map': [
              { channel: { name: 'beta', architecture: 'amd64' }, version: '9.9.9' },
              { channel: { name: 'stable', architecture: 'amd64' }, version: '0.4.0' },
              { channel: { name: 'stable', architecture: 'arm64' }, version: '0.4.0' },
            ],
          }),
        );
      }) as typeof fetch,
    });
    const r = await c.check();
    expect(seen[0]).toContain('api.snapcraft.io/v2/snaps/info/mantel');
    expect(r.available).toBe(false);
    expect(r.automatic).toEqual({ revision: '12', window: '03:00–05:00', latest: '0.4.0' });
  });

  it('does not ask the store about a locally installed snap', async () => {
    const c = new UpdateChecker({
      enabled: false,
      repo: 'a/b',
      snap: { revision: 'x1' },
      fetch: (async () => {
        throw new Error('no network expected');
      }) as typeof fetch,
    });
    expect((await c.check()).automatic).toEqual({
      revision: 'x1',
      window: '03:00–05:00',
      latest: null,
    });
  });
});
