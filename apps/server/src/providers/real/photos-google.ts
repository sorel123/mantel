/**
 * Google Photos through the Picker API (v4 S). Since March 2025 the Library API can only read
 * photos an app uploaded itself, so a wall cannot browse a family's library. The Picker API is
 * Google's supported route: Mantel opens a picking session, the person opens its link on their
 * phone, chooses albums or photos in Google Photos and taps Done, and Mantel downloads what was
 * picked and keeps it. Picking again adds more.
 *
 * Checked against developers.google.com/photos/picker (Nov 2026):
 *   scope  https://www.googleapis.com/auth/photospicker.mediaitems.readonly
 *   POST   https://photospicker.googleapis.com/v1/sessions          -> id, pickerUri, expireTime, pollingConfig
 *   GET    https://photospicker.googleapis.com/v1/sessions/{id}     -> mediaItemsSet once the person taps Done
 *   GET    https://photospicker.googleapis.com/v1/mediaItems?sessionId=&pageSize<=100&pageToken=
 *   DELETE https://photospicker.googleapis.com/v1/sessions/{id}
 *   bytes  {mediaFile.baseUrl}=w2400-h2400 with the bearer token; a baseUrl lasts 60 minutes,
 *          so photos are downloaded as soon as the picking ends.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { Db } from '../../db/index.js';

export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PICKER = 'https://photospicker.googleapis.com/v1';
const TOKENS_KEY = 'photos.google.tokens';
const STATE_KEY = 'photos.google.state';

export interface GooglePhotosTokens {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: number;
  revoked?: boolean;
}

export interface GooglePhotosAuthOptions {
  db: Db;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class GooglePhotosAuth {
  private refreshing: Promise<string> | null = null;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: GooglePhotosAuthOptions) {
    this.doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.now = o.now ?? Date.now;
  }

  get redirectUri() {
    return this.o.redirectUri;
  }

  tokens(): GooglePhotosTokens | null {
    return kvGet<GooglePhotosTokens>(this.o.db, TOKENS_KEY) ?? null;
  }

  connected(): boolean {
    const t = this.tokens();
    return Boolean(t?.refreshToken && !t.revoked);
  }

  disconnect() {
    kvSet(this.o.db, TOKENS_KEY, null);
  }

  authUrl(): string {
    const state = randomBytes(16).toString('hex');
    kvSet(this.o.db, STATE_KEY, state);
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: this.o.redirectUri,
      response_type: 'code',
      scope: PICKER_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  async finish(code: string, state: string): Promise<void> {
    if (!state || state !== kvGet<string>(this.o.db, STATE_KEY))
      throw new HttpError(
        'bad_request',
        'That sign-in link is out of date. Press Connect again and use the new one.',
      );
    const body = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.o.redirectUri,
    });
    if (!body.refresh_token)
      throw new HttpError(
        'upstream_error',
        'Google did not hand over a lasting sign-in. Try Connect again.',
      );
    kvSet(this.o.db, STATE_KEY, null);
    kvSet(this.o.db, TOKENS_KEY, {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
    });
  }

  async accessToken(): Promise<string> {
    const t = this.tokens();
    if (!t?.refreshToken || t.revoked)
      throw new HttpError(
        'bad_request',
        'Google Photos is not connected. Press Connect in Settings first.',
      );
    if (t.accessToken && (t.expiresAt ?? 0) - 60_000 > this.now()) return t.accessToken;
    this.refreshing ??= this.token({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
      .then((body) => {
        kvSet(this.o.db, TOKENS_KEY, {
          ...t,
          accessToken: body.access_token,
          expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
          ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
        });
        return body.access_token;
      })
      .catch((err: unknown) => {
        if (err instanceof HttpError && /invalid_grant/.test(err.message))
          kvSet(this.o.db, TOKENS_KEY, { ...t, revoked: true });
        throw err;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async token(params: Record<string, string>) {
    const res = await this.doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        ...params,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError('upstream_error', `Google token ${res.status}: ${text}`);
    return JSON.parse(text) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };
  }
}

const Session = z.object({
  id: z.string(),
  pickerUri: z.string().optional(),
  expireTime: z.string().optional(),
  mediaItemsSet: z.boolean().optional(),
});
export type PickerSession = z.infer<typeof Session>;

const MediaItem = z.object({
  id: z.string(),
  createTime: z.string().optional(),
  type: z.string().optional(),
  mediaFile: z
    .object({
      baseUrl: z.string(),
      mimeType: z.string().optional(),
      filename: z.string().optional(),
    })
    .optional(),
});
export type PickedItem = z.infer<typeof MediaItem>;
const MediaItems = z.object({
  mediaItems: z.array(MediaItem).default([]),
  nextPageToken: z.string().optional(),
});

/** The Picker API's REST calls. */
export class PickerClient {
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly auth: Pick<GooglePhotosAuth, 'accessToken'>,
    f?: typeof fetch,
  ) {
    this.doFetch = f ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.accessToken();
    const res = await this.doFetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 403 && url.startsWith(PICKER))
      throw new HttpError(
        'upstream_error',
        'Google refused: the Photos Picker API is not turned on for this Google sign-in app. See the Google Photos steps.',
      );
    if (res.status === 400 && url.endsWith('/sessions'))
      throw new HttpError('upstream_error', 'Google says this account has no Google Photos yet.');
    if (!res.ok) throw new HttpError('upstream_error', `Google Photos answered ${res.status}.`);
    return res;
  }

  async create(): Promise<PickerSession> {
    const res = await this.call(`${PICKER}/sessions`, { method: 'POST', body: '{}' });
    return Session.parse(await res.json());
  }

  async get(id: string): Promise<PickerSession> {
    const res = await this.call(`${PICKER}/sessions/${encodeURIComponent(id)}`);
    return Session.parse(await res.json());
  }

  async items(sessionId: string): Promise<PickedItem[]> {
    const out: PickedItem[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        sessionId,
        pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.call(`${PICKER}/mediaItems?${q}`);
      const body = MediaItems.parse(await res.json());
      out.push(...body.mediaItems);
      pageToken = body.nextPageToken;
    } while (pageToken && out.length < 5000);
    return out;
  }

  async remove(id: string): Promise<void> {
    await this.call(`${PICKER}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  }

  /** A picked photo's bytes, fitted inside 2400 px. */
  async download(baseUrl: string): Promise<Uint8Array> {
    const res = await this.call(`${baseUrl}=w2400-h2400`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
