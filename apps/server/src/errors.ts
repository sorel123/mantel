import type { ApiError } from '@mantel/shared';

type Code = ApiError['error']['code'];

const status: Record<Code, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  not_implemented: 501,
  upstream_error: 502,
  internal: 500,
  disabled: 503,
};

/** Throw from a route or provider to answer with `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  get status() {
    return status[this.code];
  }
}

export const notFound = (what: string) => new HttpError('not_found', `${what} not found`);
export const notImplemented = (what: string) =>
  new HttpError('not_implemented', `${what} is not implemented yet; run with MOCK=1`);
