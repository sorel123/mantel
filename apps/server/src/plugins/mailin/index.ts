/**
 * Forward to Mantel (v4 K): a mailbox Mantel checks every couple of minutes. Mail from an allowed
 * sender (anyone with their email in Settings › People, plus the extra addresses or @domains in
 * the plugin) becomes inbox items: the body, and each PDF, photo and calendar attachment. Mail
 * from anyone else is marked read, counted and otherwise ignored. Nothing is ever sent.
 */
import { mailinManifest, type IntegrationConfig } from '@mantel/shared';
import { log } from '../../log.js';
import type { ProviderContext } from '../../providers/types.js';
import { setMailInfo, whenInbox, type InboxService } from '../inbox/index.js';
import { htmlToText } from '../inbox/service.js';
import { humanError } from '../registry.js';
import type { Plugin } from '../types.js';
import {
  PRESETS,
  memoryMailbox,
  openImap,
  type MailMessage,
  type MailboxOptions,
  type OpenMailbox,
} from './mailbox.js';
import { INVITE_JPEG_BASE64, NEWSLETTER_PDF_BASE64 } from './fixtures.js';

export const manifest = mailinManifest;

/** At most this many messages per check, so a full mailbox does not flood the inbox. */
const PER_CHECK = 20;
/** Inline images smaller than this are logos and signatures. */
const MIN_INLINE_IMAGE = 30_000;

/** Addresses and @domains from a comma, space or newline separated list. */
export function parseAllowList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]*@[^@\s]+\.[^@\s]+$/.test(s));
}

export function isAllowed(from: string, allowed: string[]): boolean {
  const addr = from.toLowerCase();
  if (!addr.includes('@')) return false;
  const domain = addr.slice(addr.indexOf('@'));
  return allowed.some((a) => (a.startsWith('@') ? a === domain : a === addr));
}

/** Gmail and iCloud presets, or the typed server. */
export function connection(config: IntegrationConfig, secrets: Record<string, string>): MailboxOptions | null {
  const address = String(config.address ?? '').trim();
  const pass = secrets.appPassword ?? '';
  if (!address || !pass) return null;
  const provider = String(config.provider ?? 'gmail');
  const preset = PRESETS[provider];
  const host = preset?.host ?? String(config.host ?? '').trim();
  if (!host) return null;
  return {
    host,
    port: Number(config.port) || preset?.port || 993,
    user: String(config.username ?? '').trim() || address,
    pass,
    folder: String(config.folder ?? '').trim() || 'INBOX',
  };
}

/** The pieces of one message worth reading. */
export function capturesOf(m: MailMessage) {
  const files = m.attachments.filter((a) => {
    const t = a.contentType.toLowerCase();
    const name = (a.filename ?? '').toLowerCase();
    if (t === 'application/pdf' || name.endsWith('.pdf')) return true;
    if (t === 'text/calendar' || t === 'application/ics' || name.endsWith('.ics')) return true;
    if (t.startsWith('image/')) return !a.inline || a.content.length >= MIN_INLINE_IMAGE;
    return false;
  });
  const body = (m.text || (m.html ? htmlToText(m.html) : '')).trim();
  // A short "see attached" adds nothing; a body alone, or a long one, is read too.
  const useBody = body.length > 0 && (!files.length || body.length > 280);
  return { files, body: useBody ? body : null };
}

export interface MailinOptions {
  open?: OpenMailbox;
  /** Values used until something is saved (mock mode). */
  fallback?: { config: IntegrationConfig; secrets: Record<string, string> };
}

export function mailinPlugin(opts: MailinOptions = {}): Plugin {
  const open = opts.open ?? openImap;
  let ctx: ProviderContext | null = null;
  let options: MailboxOptions | null = null;
  let extra: string[] = [];
  let address: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let first: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastOkAt: string | null = null;
  let lastError: string | null = null;
  let delivered = 0;
  let ignored = 0;

  const allowed = () => [
    ...(ctx?.settings().people ?? [])
      .map((p) => p.email?.trim().toLowerCase())
      .filter((e): e is string => !!e && e.includes('@')),
    ...extra,
  ];

  const ago = (iso: string | null) => {
    if (!iso) return 'not checked yet';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    return min < 1 ? 'checked just now' : `checked ${min} minute${min === 1 ? '' : 's'} ago`;
  };

  const summary = () =>
    [
      address,
      ago(lastOkAt),
      delivered ? `${delivered} added to the inbox` : '',
      ignored ? `${ignored} ignored` : '',
    ]
      .filter(Boolean)
      .join(', ');

  async function deliver(inbox: InboxService, m: MailMessage) {
    const { files, body } = capturesOf(m);
    const meta = { source: 'email' as const, hint: 'auto' as const, from: m.from, subject: m.subject || null };
    let n = 0;
    for (const [i, f] of files.entries()) {
      const key = `mail:${m.messageId}:${i}`;
      if (inbox.store.hasKey(key)) continue;
      try {
        await inbox.captureFile(
          { bytes: f.content, mime: f.contentType, name: f.filename },
          { ...meta, dedupeKey: key },
        );
        n++;
      } catch (err) {
        log.warn('mailin: attachment skipped', { err: String(err), file: f.filename });
      }
    }
    if (body) {
      const key = `mail:${m.messageId}:body`;
      if (!inbox.store.hasKey(key)) {
        await inbox.captureText(body, { ...meta, name: null, dedupeKey: key });
        n++;
      }
    }
    return n;
  }

  async function check() {
    if (!ctx || !options || running) return;
    running = true;
    const conn = options;
    try {
      const inbox = await whenInbox(ctx.db);
      const box = await open(conn);
      try {
        const mail = await box.unread(PER_CHECK);
        const allow = allowed();
        const done: number[] = [];
        for (const m of mail) {
          if (isAllowed(m.from, allow)) delivered += await deliver(inbox, m);
          else {
            ignored++;
            log.info('mailin: ignored mail from a sender not on the list', { from: m.from });
          }
          done.push(m.uid);
        }
        await box.markRead(done);
      } finally {
        await box.close().catch(() => {});
      }
      lastOkAt = new Date().toISOString();
      lastError = null;
      ctx.markSynced('mailin');
    } catch (err) {
      lastError = humanError(err);
      log.warn('mailin: check failed', { err: String(err) });
    } finally {
      running = false;
    }
  }

  function stopTimers() {
    if (timer) clearInterval(timer);
    if (first) clearTimeout(first);
    timer = first = null;
  }

  return {
    manifest,
    start(c) {
      ctx = c;
      setMailInfo(c.db, () => ({
        address,
        state: !options ? 'not_set_up' : lastError ? 'error' : 'connected',
        summary: options ? summary() : 'Not set up',
        ignored,
        allowed: allowed(),
      }));
    },
    stop() {
      stopTimers();
    },
    apply(config, secrets) {
      stopTimers();
      const fb = opts.fallback;
      const useFallback = fb && !String(config.address ?? '').trim();
      const c = useFallback ? { ...config, ...fb.config } : config;
      const s = useFallback ? { ...secrets, ...fb.secrets } : secrets;
      options = connection(c, s);
      extra = parseAllowList(String(c.allowFrom ?? ''));
      address = String(c.address ?? '').trim() || null;
      lastError = null;
      if (!options) return;
      const minutes = Math.min(60, Math.max(1, Number(c.pollMinutes) || 2));
      first = setTimeout(() => void check(), 1_000);
      timer = setInterval(() => void check(), minutes * 60_000);
      timer.unref?.();
      first.unref?.();
    },
    async test(config, secrets) {
      const conn = connection(config, secrets);
      if (!conn)
        return {
          ok: false,
          message: 'Type the address and the app password first (and the server, for Another).',
        };
      try {
        const box = await open(conn);
        try {
          const { count, last } = await box.summary();
          if (!last) return { ok: true, message: `Signed in to ${conn.user}. The mailbox is empty.` };
          const when = last.date ? ` on ${last.date.toLocaleDateString()}` : '';
          return {
            ok: true,
            message: `Signed in. ${count} message${count === 1 ? '' : 's'}; the newest is "${last.subject || '(no subject)'}" from ${last.from || 'an unknown sender'}${when}. Nothing was sent or changed.`,
          };
        } finally {
          await box.close().catch(() => {});
        }
      } catch (err) {
        const text = String(err);
        if (/auth|credentials|login|invalid/i.test(text))
          return {
            ok: false,
            message:
              'The mail service refused the sign-in. Check the address, and use an app password, not the normal one.',
          };
        return { ok: false, message: humanError(err) };
      }
    },
    status() {
      if (!options) return { state: 'not_set_up', summary: 'Not set up', lastOkAt: null, lastError: null };
      return {
        state: lastError ? 'error' : 'connected',
        summary: summary(),
        lastOkAt,
        lastError,
      };
    },
  };
}

/* ---- mock mode: a mailbox with the school newsletter, the party invite and a stranger ---- */

export function mockMailbox(now = new Date()): OpenMailbox {
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  return memoryMailbox([
    {
      uid: 1,
      messageId: '<newsletter-nov@lincoln-elementary.example>',
      from: 'office@lincoln-elementary.example',
      subject: 'Lincoln Lions News: November',
      date: at(25),
      text: 'Please see the attached newsletter.',
      html: null,
      attachments: [
        {
          filename: 'Lincoln-Lions-News-November.pdf',
          contentType: 'application/pdf',
          content: Buffer.from(NEWSLETTER_PDF_BASE64, 'base64'),
          inline: false,
        },
      ],
    },
    {
      uid: 2,
      messageId: '<maya-party@example.com>',
      from: 'priya@example.com',
      subject: "Maya's party!",
      date: at(120),
      text: 'Hope Leo can come!',
      html: null,
      attachments: [
        {
          filename: 'maya-party-invite.jpg',
          contentType: 'image/jpeg',
          content: Buffer.from(INVITE_JPEG_BASE64, 'base64'),
          inline: false,
        },
      ],
    },
    {
      uid: 3,
      messageId: '<deal@shop.example>',
      from: 'deals@shop.example',
      subject: 'Big savings this weekend',
      date: at(60),
      text: 'Buy now! Sale ends Sunday at 9.',
      html: null,
      attachments: [],
    },
  ]);
}

export const mockMailinFallback = {
  config: {
    provider: 'gmail',
    address: 'ourfamily.mantel@gmail.com',
    allowFrom: '@lincoln-elementary.example, priya@example.com',
  },
  secrets: { appPassword: 'mock-app-password' },
};
