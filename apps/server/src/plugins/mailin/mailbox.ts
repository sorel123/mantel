/**
 * The mailbox Forward to Mantel reads, behind a small interface so mock mode and the tests can
 * hand in fixture mail. The real one is IMAP over TLS (imapflow), parsed with mailparser.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';

export interface MailAttachment {
  filename: string | null;
  contentType: string;
  content: Buffer;
  /** Inline images (logos in a signature) are usually skipped. */
  inline: boolean;
}

export interface MailMessage {
  uid: number;
  messageId: string;
  /** Lower-cased sender address. */
  from: string;
  subject: string;
  date: Date | null;
  text: string;
  html: string | null;
  attachments: MailAttachment[];
}

export interface MailboxSummary {
  count: number;
  last: { from: string; subject: string; date: Date | null } | null;
}

export interface Mailbox {
  /** Unread messages, oldest first, at most `limit`. */
  unread(limit: number): Promise<MailMessage[]>;
  markRead(uids: number[]): Promise<void>;
  /** For Test: how many messages, and the newest one. Changes nothing. */
  summary(): Promise<MailboxSummary>;
  close(): Promise<void>;
}

export interface MailboxOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  folder: string;
}

export type OpenMailbox = (o: MailboxOptions) => Promise<Mailbox>;

export const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 },
};

const firstAddress = (a: AddressObject | AddressObject[] | undefined): string => {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  for (const o of list) for (const v of o.value) if (v.address) return v.address.toLowerCase();
  return '';
};

/** Raw RFC 822 bytes to a message. */
export async function parseMail(uid: number, source: Buffer): Promise<MailMessage> {
  const m = await simpleParser(source, { skipImageLinks: true });
  return {
    uid,
    messageId: m.messageId ?? `uid-${uid}`,
    from: firstAddress(m.from),
    subject: m.subject ?? '',
    date: m.date ?? null,
    text: m.text ?? '',
    html: typeof m.html === 'string' ? m.html : null,
    attachments: m.attachments.map((a) => ({
      filename: a.filename ?? null,
      contentType: a.contentType,
      content: a.content,
      inline: a.contentDisposition === 'inline' || !!a.related,
    })),
  };
}

export const openImap: OpenMailbox = async (o) => {
  const client = new ImapFlow({
    host: o.host,
    port: o.port,
    secure: o.port === 993,
    auth: { user: o.user, pass: o.pass.replace(/\s+/g, '') },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // A dropped connection must not crash the server.
  client.on('error', () => {});
  await client.connect();
  const lock = await client.getMailboxLock(o.folder);
  return {
    async unread(limit) {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      const pick = uids.sort((a, b) => a - b).slice(0, limit);
      const out: MailMessage[] = [];
      if (!pick.length) return out;
      for await (const msg of client.fetch(pick, { uid: true, source: true }, { uid: true })) {
        if (msg.source) out.push(await parseMail(msg.uid, msg.source));
      }
      return out;
    },
    async markRead(uids) {
      if (uids.length) await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
    },
    async summary() {
      const count = client.mailbox ? client.mailbox.exists : 0;
      if (!count) return { count, last: null };
      const msg = await client.fetchOne(String(count), { envelope: true });
      const env = msg ? msg.envelope : undefined;
      return {
        count,
        last: env
          ? {
              from: env.from?.[0]?.address?.toLowerCase() ?? '',
              subject: env.subject ?? '',
              date: env.date ?? null,
            }
          : null,
      };
    },
    async close() {
      lock.release();
      await client.logout().catch(() => client.close());
    },
  };
};

/** A mailbox in memory: mock mode and the tests. Messages are read once. */
export function memoryMailbox(messages: MailMessage[]): OpenMailbox {
  const read = new Set<number>();
  return async () => ({
    async unread(limit) {
      return messages.filter((m) => !read.has(m.uid)).slice(0, limit);
    },
    async markRead(uids) {
      for (const u of uids) read.add(u);
    },
    async summary() {
      const last = messages.at(-1);
      return {
        count: messages.length,
        last: last ? { from: last.from, subject: last.subject, date: last.date } : null,
      };
    },
    async close() {},
  });
}
