/**
 * v4 K: the capture inbox. Routes (`/inbox`), the multipart upload the iPhone Shortcut and the
 * phone's share sheet post to (`/inbox/upload`), and the `inbox` plugin, whose only job on the
 * wall is the dock chip with the count. See docs/capture.md.
 */
import {
  DEVICE_KEY_HEADER,
  TOKEN_PREFIX,
  inboxManifest,
  type ImportHint,
  type InboxSource,
} from '@mantel/shared';
import type { Hono } from 'hono';
import type { AppDeps } from '../../app.js';
import { scopeAllows, tokenFromHeaders, type ApiTokens, type DeviceAuth } from '../../auth.js';
import type { Handle } from '../../contract.js';
import type { Db } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';
import { isoInZone } from '../../providers/real/weather-time.js';
import type { ProviderContext } from '../../providers/types.js';
import type { MealsService } from '../meals/index.js';
import type { Plugin } from '../types.js';
import { InboxService, type IncomingFile } from './service.js';
import { InboxStore } from './store.js';

export { InboxService, sniff, htmlToText } from './service.js';
export { InboxStore } from './store.js';
export const manifest = inboxManifest;

/* ---- one inbox per database, so the mail plugin and the routes find each other ---- */

const services = new WeakMap<Db, InboxService>();
const waiting = new WeakMap<Db, Array<(s: InboxService) => void>>();

/** The inbox for this server, once its routes are registered. */
export function whenInbox(db: Db): Promise<InboxService> {
  const s = services.get(db);
  if (s) return Promise.resolve(s);
  return new Promise((resolve) => {
    const list = waiting.get(db) ?? [];
    list.push(resolve);
    waiting.set(db, list);
  });
}
export const inboxFor = (db: Db) => services.get(db) ?? null;

/** What Forward to Mantel tells the inbox status route (set by the mailin plugin). */
export interface MailInfo {
  address: string | null;
  state: 'off' | 'not_set_up' | 'connected' | 'error';
  summary: string;
  ignored: number;
  allowed: string[];
}
const mailInfo = new WeakMap<Db, () => MailInfo>();
export const setMailInfo = (db: Db, get: () => MailInfo) => mailInfo.set(db, get);

/* ---- routes ---- */

export function registerInboxRoutes(handle: Handle, deps: AppDeps, planner?: MealsService) {
  const { db, hub, settings, providers, registry, config, auth } = deps;
  const tz = () => settings.get().timezone;
  const service = new InboxService({
    store: new InboxStore(
      db,
      () => new Date(),
      (d) => isoInZone(d, tz()),
    ),
    providers,
    ...(planner ? { planner } : {}),
    emit: (e) => hub.broadcast(e),
    now: () => new Date(),
    timeZone: tz,
    people: () => settings.get().people,
    claudeKey: () => registry.resolve('quips').secrets.claudeApiKey ?? '',
    mock: config.MOCK,
  });
  services.set(db, service);
  for (const resolve of waiting.get(db) ?? []) resolve(service);
  waiting.delete(db);

  const deviceName = (id: string | null) =>
    id ? (auth.list(id).find((d) => d.current)?.name ?? null) : null;

  handle('inbox', async () => service.list());

  handle('inboxStatus', async () => {
    const mail = mailInfo.get(db)?.() ?? {
      address: null,
      state: 'not_set_up' as const,
      summary: 'Not set up',
      ignored: 0,
      allowed: [],
    };
    const on = registry.enabled('mailin');
    return {
      pending: service.pending(),
      canRead: service.canRead(),
      readMessage: config.MOCK
        ? 'Mock mode: captures read as sample flyers.'
        : service.canRead()
          ? 'Ready. Photos, PDFs and text are sent to Anthropic to be read, then shown here to check.'
          : 'Add a Claude key in Settings › Weather quips to read photos, PDFs and text. Calendar files (.ics) work without one.',
      mailAddress: mail.address,
      mailState: on ? mail.state : 'off',
      mailSummary: on ? mail.summary : 'Turned off',
      mailIgnored: mail.ignored,
      allowedSenders: mail.allowed,
    };
  });

  handle('inboxCreate', async ({ body, deviceId }) => {
    const from = deviceName(deviceId);
    const meta = {
      hint: body.hint,
      from,
      subject: body.subject ?? null,
    };
    if (body.file) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(body.file)!;
      const item = await service.captureFile(
        { bytes: Buffer.from(m[2]!, 'base64'), mime: m[1]!, name: body.name ?? null },
        { ...meta, source: body.source ?? (m[1]!.startsWith('image/') ? 'photo' : 'share') },
      );
      return { item };
    }
    const item = await service.captureText(body.text ?? '', {
      ...meta,
      source: body.source ?? 'text',
      name: body.name ?? null,
    });
    return { item };
  });

  handle('inboxCommit', async ({ params, body }) => service.commit(params.id!, body));
  handle('inboxUndo', async ({ params }) => service.undoCommit(params.id!));
  handle('inboxRetry', async ({ params }) => ({ item: service.retry(params.id!) }));
  handle('inboxDelete', async ({ params }) => {
    service.dismiss(params.id!);
    return { ok: true as const };
  });

  handle('inboxOriginal', async ({ c, params, query }) => {
    if (!auth.verify(c.req.header(DEVICE_KEY_HEADER) ?? query.key))
      throw new HttpError('unauthorized', 'missing or invalid device key');
    const o = service.store.original(params.id!);
    if (!o) throw notFound(`inbox original ${params.id}`);
    const name = (o.name ?? 'original').replace(/[^\w.\- ]+/g, '_');
    return new Response(new Uint8Array(o.body), {
      headers: {
        'content-type': o.mime,
        'content-disposition': `inline; filename="${name}"`,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        // A PDF or text shown in a tab must not run anything.
        'content-security-policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

  handle('inboxShortcutKey', async ({ c }) => {
    const { deviceId, deviceKey } = auth.pairLocal('Send to Mantel (Shortcut)');
    return { deviceId, key: deviceKey, url: `${new URL(c.req.url).origin}/api/inbox/upload` };
  });

  return service;
}

/* ---- the form upload: the iPhone Shortcut and the phone's share sheet ---- */

const HINTS = new Set(['auto', 'events', 'list', 'meals']);

/**
 * `POST /api/inbox/upload` (multipart/form-data, or a raw body): fields `file` (one or more),
 * `text`, `url`, `title`, `hint`. The device key comes in the `x-mantel-device-key` header, or a
 * `key` field for tools that cannot set headers. Answers one sentence for the Shortcut to show
 * (JSON when asked with `accept: application/json`).
 */
/**
 * `POST /api/inbox/upload`: what the iPhone Shortcut and scripts send. It takes a display key (the
 * Shortcut key made in Settings › Capture) or an API token with the `capture` scope (v4 O).
 */
export function mountInboxUpload(api: Hono, auth: DeviceAuth, db: Db, tokens?: ApiTokens) {
  api.post('/inbox/upload', async (c) => {
    const service = inboxFor(db);
    if (!service) throw new HttpError('not_implemented', 'The inbox is not ready yet.');
    const type = c.req.header('content-type') ?? '';
    const files: IncomingFile[] = [];
    const texts: string[] = [];
    let key = c.req.header(DEVICE_KEY_HEADER) ?? c.req.query('key') ?? null;
    let title: string | null = null;
    let hint: ImportHint = 'auto';
    if (/multipart\/form-data|application\/x-www-form-urlencoded/.test(type)) {
      const form = await c.req.parseBody({ all: true });
      const all = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
      for (const [name, value] of Object.entries(form))
        for (const v of all(value)) {
          if (v instanceof File) {
            if (v.size === 0) continue;
            if (v.size > 15_000_000) throw new HttpError('bad_request', 'That file is over 15 MB.');
            files.push({ bytes: Buffer.from(await v.arrayBuffer()), mime: v.type, name: v.name });
          } else if (typeof v === 'string') {
            if (name === 'key') key ??= v;
            else if (name === 'title') title = v.trim().slice(0, 300) || null;
            else if (name === 'hint' && HINTS.has(v)) hint = v as ImportHint;
            else if (v.trim()) texts.push(v.trim());
          }
        }
    } else {
      const bytes = Buffer.from(await c.req.arrayBuffer());
      if (bytes.length > 15_000_000) throw new HttpError('bad_request', 'That file is over 15 MB.');
      if (bytes.length)
        files.push({
          bytes,
          mime: type,
          name: c.req.header('x-file-name') ?? null,
        });
    }
    const header = (n: string) => c.req.header(n);
    const tokenSecret = tokenFromHeaders(header) ?? (key?.startsWith(TOKEN_PREFIX) ? key : null);
    const token = tokenSecret ? (tokens?.verify(tokenSecret) ?? null) : null;
    if (token && !scopeAllows(token.scopes, ['capture']))
      throw new HttpError(
        'forbidden',
        `The token "${token.name}" cannot send to the inbox; give it Capture in Settings.`,
      );
    const deviceId = token ? null : auth.verify(key);
    if (!token && !deviceId)
      throw new HttpError(
        'unauthorized',
        'Mantel did not recognise the key. Copy it again from Settings › Capture.',
      );
    const from = token ? token.name : (auth.list(deviceId!).find((d) => d.current)?.name ?? null);
    const source: InboxSource = 'share';
    const created = [];
    for (const f of files)
      created.push(await service.captureFile(f, { source, hint, from, subject: title }));
    // Shared text and links (a page's title and address) make one text capture.
    const words = [...new Set(texts)].join('\n');
    if (words)
      created.push(
        await service.captureText(words, { source, hint, from, subject: title, name: null }),
      );
    if (!created.length)
      throw new HttpError('bad_request', 'Nothing was shared. Send a photo, a PDF or some text.');
    const message =
      created.length === 1
        ? 'Sent to Mantel. Check it in the inbox on the wall or the phone app.'
        : `Sent ${created.length} things to Mantel. Check them in the inbox.`;
    if ((c.req.header('accept') ?? '').includes('application/json'))
      return c.json({ ok: true, message, items: created });
    return c.text(message);
  });
}

/* ---- the plugin: the dock chip ---- */

export function inboxPlugin(): Plugin {
  let ctx: ProviderContext | null = null;
  const service = () => (ctx ? inboxFor(ctx.db) : null);
  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply() {},
    async test() {
      const n = service()?.pending() ?? 0;
      return { ok: true, message: n ? `${n} waiting in the inbox.` : 'The inbox is empty.' };
    },
    status() {
      const n = service()?.pending() ?? 0;
      return {
        state: 'connected',
        summary: n ? `${n} thing${n === 1 ? '' : 's'} to check` : 'Empty',
        lastOkAt: null,
        lastError: null,
      };
    },
    chip(name) {
      if (name !== 'chip') return undefined;
      const s = service();
      if (!s) return null;
      const pending = s.pending();
      if (!pending) return null;
      // Calm on purpose: `warn` pulses, which is for a timer ringing, not mail waiting.
      return {
        text: String(pending),
        icon: 'inbox',
        tone: 'normal',
        label: `Inbox: ${pending} thing${pending === 1 ? '' : 's'} to check`,
      };
    },
  };
}
