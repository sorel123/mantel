import { DEVICE_KEY_HEADER, routes, type ResponseOf, type RouteName } from '@mantel/shared';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { DeviceAuth } from './auth.js';
import { HttpError } from './errors.js';

type Route<N extends RouteName> = (typeof routes)[N];
type Parsed<S> = S extends z.ZodType ? z.output<S> : never;

export interface HandlerArgs<N extends RouteName> {
  c: Context;
  query: Parsed<Route<N>['query']>;
  body: Parsed<Route<N>['body']>;
  params: Record<string, string>;
  deviceId: string | null;
}

export interface ContractOptions {
  auth: DeviceAuth;
  /** Check every response against its schema; on outside production so drift fails loudly. */
  validateResponses: boolean;
}

/**
 * Register a handler for a contract route. Query and body are parsed with the route's
 * schemas, the device key is checked, and the JSON result is (optionally) validated.
 * Routes whose `response` is null return a raw `Response`.
 */
export function makeHandle(app: Hono, opts: ContractOptions) {
  return function handle<N extends RouteName>(
    name: N,
    handler: (
      args: HandlerArgs<N>,
    ) => Promise<Route<N>['response'] extends null ? Response : ResponseOf<N>>,
  ) {
    const def = routes[name];
    app.on(def.method, def.path, async (c) => {
      const deviceId = opts.auth.verify(c.req.header(DEVICE_KEY_HEADER));
      if (def.auth && !deviceId)
        throw new HttpError('unauthorized', 'missing or invalid device key');

      const query = def.query.safeParse(c.req.query());
      if (!query.success) throw new HttpError('bad_request', `query: ${query.error.message}`);

      let rawBody: unknown = undefined;
      if (def.method !== 'GET' && def.method !== 'DELETE') {
        const text = await c.req.text();
        if (text) {
          try {
            rawBody = JSON.parse(text);
          } catch {
            throw new HttpError('bad_request', 'body is not valid JSON');
          }
        }
      }
      const body = def.body.safeParse(rawBody);
      if (!body.success) throw new HttpError('bad_request', `body: ${body.error.message}`);

      const result = await handler({
        c,
        query: query.data as HandlerArgs<N>['query'],
        body: body.data as HandlerArgs<N>['body'],
        params: c.req.param() as Record<string, string>,
        deviceId,
      });
      if (result instanceof Response) return result;
      if (opts.validateResponses && def.response) {
        const check = def.response.safeParse(result);
        if (!check.success) {
          throw new HttpError(
            'internal',
            `response for ${name} breaks the contract: ${check.error.message}`,
          );
        }
      }
      return c.json(result as object);
    });
  };
}

export type Handle = ReturnType<typeof makeHandle>;
