/**
 * A small typed client for the REST contract, used by the display and by tests.
 *
 *   const api = createApiClient({ baseUrl: '', deviceKey });
 *   const { events } = await api.call('calendar', { query: { from, to } });
 *   await api.call('itemPatch', { params: { id }, body: { done: true } });
 */
import {
  API_PREFIX,
  DEVICE_KEY_HEADER,
  buildPath,
  routes,
  type BodyOf,
  type ParamsOf,
  type QueryOf,
  type ResponseOf,
  type RouteName,
} from './api.js';

export interface ApiClientOptions {
  /** Origin of the server, `''` for same-origin. */
  baseUrl?: string;
  deviceKey?: string | null;
  fetch?: typeof fetch;
}

type CallArgs<N extends RouteName> = (keyof ParamsOf<N> extends never
  ? { params?: undefined }
  : { params: ParamsOf<N> }) &
  (undefined extends BodyOf<N> ? { body?: BodyOf<N> } : { body: BodyOf<N> }) & {
    query?: QueryOf<N>;
    signal?: AbortSignal;
  };

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function routeUrl<N extends RouteName>(
  name: N,
  params?: Record<string, string>,
  query?: Record<string, unknown>,
  baseUrl = '',
): string {
  let url = baseUrl + API_PREFIX + buildPath(routes[name].path, params);
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let deviceKey = opts.deviceKey ?? null;

  async function call<N extends RouteName>(name: N, args?: CallArgs<N>): Promise<ResponseOf<N>> {
    const def = routes[name];
    const a = (args ?? {}) as {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
      signal?: AbortSignal;
    };
    const headers: Record<string, string> = { accept: 'application/json' };
    if (deviceKey) headers[DEVICE_KEY_HEADER] = deviceKey;
    if (a.body !== undefined) headers['content-type'] = 'application/json';
    const res = await doFetch(routeUrl(name, a.params, a.query, opts.baseUrl), {
      method: def.method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
      signal: a.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiRequestError(
        res.status,
        err?.code ?? 'internal',
        err?.message ?? res.statusText,
      );
    }
    return json as ResponseOf<N>;
  }

  return {
    call,
    setDeviceKey(key: string | null) {
      deviceKey = key;
    },
    get deviceKey() {
      return deviceKey;
    },
    url: (name: RouteName, params?: Record<string, string>, query?: Record<string, unknown>) =>
      routeUrl(name, params, query, opts.baseUrl),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
