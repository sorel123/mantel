import { describe, expect, it, vi } from 'vitest';
import { DEVICE_KEY_HEADER, buildPath } from './api.js';
import { ApiRequestError, createApiClient } from './client.js';
import { parseWsEvent } from './ws.js';

describe('client', () => {
  it('builds paths and sends the device key', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ item: { id: 'a', text: 'x', done: true } })),
    );
    const api = createApiClient({ baseUrl: 'http://h', deviceKey: 'k', fetch });
    await api.call('itemPatch', { params: { id: 'a b' }, body: { done: true } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://h/api/items/a%20b');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)[DEVICE_KEY_HEADER]).toBe('k');
  });

  it('adds query strings and raises contract errors', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope' } }), {
          status: 404,
        }),
    );
    const api = createApiClient({ fetch });
    await expect(api.call('photosNext', { query: { n: 3 } })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('/api/photos/next?n=3');
  });

  it('requires every path param', () => {
    expect(() => buildPath('/lists/:id/items')).toThrow('id');
  });

  it('ignores unknown WebSocket messages', () => {
    expect(parseWsEvent('{"type":"nope","payload":{}}')).toBeNull();
    expect(parseWsEvent('not json')).toBeNull();
    expect(parseWsEvent('{"type":"list.changed","payload":{"listId":"g"}}')?.type).toBe(
      'list.changed',
    );
  });
});
