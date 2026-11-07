/**
 * Web Push: phones that allowed notifications get the doorbell, someone else's finished chore,
 * a leave-by ten minutes out, a redeemed reward and new wall notes. The VAPID key pair is made
 * on first use and kept in the secrets store; subscriptions live in `push_subscriptions`.
 *
 * Browsers only offer push in a secure context: https, or http://localhost. On a plain-http LAN
 * address the companion explains that instead of offering the switch.
 */
import { randomUUID } from 'node:crypto';
import type { PushPatchRequest, PushSubscribeRequest } from '@mantel/shared';
import {
  type Chore,
  type LeaveBy,
  type Person,
  type PushEventKind,
  type PushMessage,
  type PushSubscriptionInfo,
  type WsEvent,
} from '@mantel/shared';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { z } from 'zod';
import { schema, type Db } from '../../db/index.js';
import { log } from '../../log.js';
import type { SecretStore } from '../../secrets.js';

const { pushSubscriptions: subs } = schema;
type Row = typeof subs.$inferSelect;

/** Where the keys live in the secrets store. */
export const PUSH_SECRET_ID = 'push';
const SUBJECT = 'https://github.com/sorel123/mantel';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one message. Throws an error with `statusCode` 404 or 410 when the phone is gone. */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

export interface PushServiceOptions {
  db: Db;
  secrets: SecretStore;
  now: () => Date;
  people: () => Person[];
  deviceName: (deviceId: string) => string;
  /** False for a revoked device: its phone gets nothing more. */
  active?: (deviceId: string) => boolean;
  /** Mock mode: nothing leaves the machine; deliveries land in `outbox`. */
  mock: boolean;
  sender?: PushSender;
}

const parseEvents = (s: string): PushEventKind[] => {
  try {
    return JSON.parse(s) as PushEventKind[];
  } catch {
    return [];
  }
};

export class PushService {
  /** Mock deliveries, newest last (tests and the dev route read it). */
  readonly outbox: Array<{ subscriptionId: string; message: PushMessage }> = [];
  private keys: { publicKey: string; privateKey: string } | null = null;
  private choreCounts: Map<string, number> | null = null;
  private leaveSent = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private choreTimer: NodeJS.Timeout | undefined;

  constructor(private readonly o: PushServiceOptions) {}

  /** The VAPID pair, made once and kept encrypted. */
  vapid() {
    if (this.keys) return this.keys;
    let publicKey = this.o.secrets.get(PUSH_SECRET_ID, 'vapidPublicKey');
    let privateKey = this.o.secrets.get(PUSH_SECRET_ID, 'vapidPrivateKey');
    if (!publicKey || !privateKey) {
      const made = webpush.generateVAPIDKeys();
      publicKey = made.publicKey;
      privateKey = made.privateKey;
      this.o.secrets.set(PUSH_SECRET_ID, 'vapidPublicKey', publicKey);
      this.o.secrets.set(PUSH_SECRET_ID, 'vapidPrivateKey', privateKey);
      log.info('push: made a new notification key pair');
    }
    this.keys = { publicKey, privateKey };
    return this.keys;
  }

  private info(r: Row, currentDeviceId: string | null): PushSubscriptionInfo {
    return {
      id: r.id,
      deviceId: r.deviceId,
      deviceName: this.o.deviceName(r.deviceId),
      events: parseEvents(r.events),
      personId: r.personId,
      createdAt: r.createdAt,
      lastSentAt: r.lastSentAt,
      lastError: r.lastError,
      current: r.deviceId === currentDeviceId,
    };
  }

  private row(id: string) {
    return this.o.db.select().from(subs).where(eq(subs.id, id)).get();
  }

  list(currentDeviceId: string | null): PushSubscriptionInfo[] {
    return this.o.db
      .select()
      .from(subs)
      .all()
      .map((r) => this.info(r, currentDeviceId));
  }

  get(id: string, currentDeviceId: string | null): PushSubscriptionInfo | null {
    const r = this.row(id);
    return r ? this.info(r, currentDeviceId) : null;
  }

  /** Save (or refresh) this phone's subscription. One per endpoint. */
  subscribe(deviceId: string, body: z.output<typeof PushSubscribeRequest>): PushSubscriptionInfo {
    const existing = this.o.db.select().from(subs).where(eq(subs.endpoint, body.endpoint)).get();
    const values = {
      deviceId,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      events: JSON.stringify(body.events),
      personId: body.personId,
      lastError: null,
    };
    if (existing) {
      this.o.db.update(subs).set(values).where(eq(subs.id, existing.id)).run();
      return this.info(this.row(existing.id)!, deviceId);
    }
    const id = `push-${randomUUID().slice(0, 8)}`;
    this.o.db
      .insert(subs)
      .values({
        id,
        endpoint: body.endpoint,
        createdAt: this.o.now().toISOString(),
        lastSentAt: null,
        ...values,
      })
      .run();
    return this.info(this.row(id)!, deviceId);
  }

  patch(
    id: string,
    body: z.output<typeof PushPatchRequest>,
    currentDeviceId: string | null,
  ): PushSubscriptionInfo | null {
    if (!this.row(id)) return null;
    this.o.db
      .update(subs)
      .set({
        ...(body.events ? { events: JSON.stringify(body.events) } : {}),
        ...(body.personId !== undefined ? { personId: body.personId } : {}),
      })
      .where(eq(subs.id, id))
      .run();
    return this.info(this.row(id)!, currentDeviceId);
  }

  delete(id: string): boolean {
    return this.o.db.delete(subs).where(eq(subs.id, id)).run().changes > 0;
  }

  /** Forget every subscription a revoked device held. */
  forgetDevice(deviceId: string) {
    this.o.db.delete(subs).where(eq(subs.deviceId, deviceId)).run();
  }

  private async deliver(r: Row, message: PushMessage): Promise<string | null> {
    const now = this.o.now().toISOString();
    if (this.o.mock) {
      this.outbox.push({ subscriptionId: r.id, message });
      this.o.db
        .update(subs)
        .set({ lastSentAt: now, lastError: null })
        .where(eq(subs.id, r.id))
        .run();
      return null;
    }
    const keys = this.vapid();
    const send: PushSender =
      this.o.sender ??
      (async (target, payload) => {
        await webpush.sendNotification(target, payload, {
          TTL: 15 * 60,
          vapidDetails: { subject: SUBJECT, ...keys },
          timeout: 10_000,
        });
      });
    try {
      await send(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify(message),
      );
      this.o.db
        .update(subs)
        .set({ lastSentAt: now, lastError: null })
        .where(eq(subs.id, r.id))
        .run();
      return null;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The phone unsubscribed or the browser dropped it: nothing more will reach it.
        log.info('push: a phone is gone; removing its subscription', { id: r.id });
        this.delete(r.id);
        return 'That phone no longer accepts notifications. Turn them on again from the phone.';
      }
      const text =
        status === 401 || status === 403
          ? 'The push service refused the key. Turn notifications off and on again on the phone.'
          : `Could not reach the push service${status ? ` (${status})` : ''}.`;
      this.o.db.update(subs).set({ lastError: text }).where(eq(subs.id, r.id)).run();
      log.warn('push: send failed', { id: r.id, status, err: String(err) });
      return text;
    }
  }

  /**
   * Send `message` to every subscription that chose `kind`. `exceptPersonId` skips the phone of
   * the person who did the thing; `onlyPeople` limits it to phones of those people (or phones
   * that did not say whose they are); `exceptDeviceId` skips the device that caused it.
   */
  async notify(
    kind: PushEventKind,
    message: Omit<PushMessage, 'kind'>,
    opts: { exceptPersonId?: string; onlyPeople?: string[]; exceptDeviceId?: string | null } = {},
  ): Promise<number> {
    const rows = this.o.db
      .select()
      .from(subs)
      .all()
      .filter((r) => parseEvents(r.events).includes(kind))
      .filter((r) => this.o.active?.(r.deviceId) ?? true)
      .filter((r) => !opts.exceptPersonId || r.personId !== opts.exceptPersonId)
      .filter((r) => !opts.exceptDeviceId || r.deviceId !== opts.exceptDeviceId)
      .filter(
        (r) => !opts.onlyPeople?.length || !r.personId || opts.onlyPeople.includes(r.personId),
      );
    const results = await Promise.all(rows.map((r) => this.deliver(r, { kind, ...message })));
    return results.filter((e) => e === null).length;
  }

  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const r = this.row(id);
    if (!r) return { ok: false, message: 'That phone is not subscribed any more.' };
    const err = await this.deliver(r, {
      kind: 'note',
      title: 'Mantel',
      body: 'Notifications work. This is how the doorbell and chores will look.',
      url: '/app',
      tag: 'mantel-test',
    });
    return err
      ? { ok: false, message: err }
      : { ok: true, message: 'Sent. It should arrive in a few seconds.' };
  }

  private personName(id: string | undefined) {
    return this.o.people().find((p) => p.id === id)?.name ?? 'Someone';
  }

  /** Turn server events into notifications. Wired to `hub.onEvent`. */
  handleEvent(e: WsEvent, loadChores: () => Promise<{ chores: Chore[] }>): void {
    if (e.type === 'home.doorbell') {
      void this.notify('doorbell', {
        title: 'Someone is at the door',
        body: 'The doorbell just rang.',
        url: '/app',
        tag: 'doorbell',
      });
      return;
    }
    if (e.type === 'chores.changed') {
      // Several taps in a row arrive as one message.
      clearTimeout(this.choreTimer);
      this.choreTimer = setTimeout(() => void this.choresChanged(loadChores), 1500);
      this.choreTimer.unref?.();
      return;
    }
    // Workstream R's event; not in the union until it lands, so match by name.
    if ((e as { type: string }).type === 'rewards.redeemed') {
      const p = (e as { payload?: Record<string, unknown> }).payload ?? {};
      const reward = p.reward as { title?: string } | undefined;
      const title = (p.title as string | undefined) ?? reward?.title ?? 'a reward';
      const personId = p.personId as string | undefined;
      void this.notify(
        'reward',
        {
          title: 'Reward redeemed',
          body: `${this.personName(personId)} cashed in stars for ${title}.`,
          url: '/app#chores',
        },
        personId ? { exceptPersonId: personId } : {},
      );
    }
  }

  /** Remember how far each chore had got, so the next change can say what was finished. */
  async primeChores(loadChores: () => Promise<{ chores: Chore[] }>) {
    try {
      const { chores } = await loadChores();
      this.choreCounts = new Map(chores.map((c) => [c.id, c.doneCount]));
    } catch {
      this.choreCounts = new Map();
    }
  }

  private async choresChanged(loadChores: () => Promise<{ chores: Chore[] }>) {
    const before = this.choreCounts;
    let chores: Chore[];
    try {
      chores = (await loadChores()).chores;
    } catch {
      return;
    }
    this.choreCounts = new Map(chores.map((c) => [c.id, c.doneCount]));
    if (!before) return;
    // A chore that just reached its target is news; a tap that only counts toward it is not.
    const finished = chores.filter(
      (c) => c.doneCount >= c.target && (before.get(c.id) ?? 0) < c.target,
    );
    const byPerson = new Map<string, Chore[]>();
    for (const c of finished) byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), c]);
    for (const [personId, list] of byPerson) {
      const name = this.personName(personId);
      const all = chores.filter((c) => c.personId === personId);
      const everything = all.length > 0 && all.every((c) => c.doneCount >= c.target);
      await this.notify(
        'chores',
        {
          title: everything ? `${name} finished every chore` : `${name} did a chore`,
          body: list.map((c) => c.title).join(', '),
          url: '/app#chores',
          tag: `chores-${personId}`,
        },
        { exceptPersonId: personId },
      );
    }
  }

  /** Check leave-by times every minute and warn ten minutes ahead, once per trip. */
  startLeaveBy(load: () => Promise<LeaveBy[]>, everyMs = 60_000) {
    const tick = async () => {
      let trips: LeaveBy[];
      try {
        trips = await load();
      } catch {
        return;
      }
      await this.leaveByTick(trips);
    };
    this.timer = setInterval(() => void tick(), everyMs);
    this.timer.unref?.();
  }

  async leaveByTick(trips: LeaveBy[]) {
    const now = this.o.now().getTime();
    for (const t of trips) {
      const mins = (Date.parse(t.leaveBy) - now) / 60_000;
      const key = `${t.destinationId}|${t.leaveBy}`;
      if (mins > 11 || mins < 8 || this.leaveSent.has(key)) continue;
      this.leaveSent.add(key);
      await this.notify(
        'leaveBy',
        {
          title: `Leave for ${t.name} in 10 minutes`,
          body: `${Math.round(t.durationMinutes)} min drive${
            t.delayMinutes > 2 ? `, ${Math.round(t.delayMinutes)} min of traffic` : ''
          }.`,
          url: '/app#calendar',
          tag: `leave-${t.destinationId}`,
        },
        { onlyPeople: t.personIds },
      );
    }
    if (this.leaveSent.size > 200) this.leaveSent = new Set([...this.leaveSent].slice(-50));
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.choreTimer);
  }
}
