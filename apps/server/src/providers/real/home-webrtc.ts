/**
 * Live camera video over WebRTC, proxied. Home Assistant 2024.11 and later (through its
 * built-in go2rtc, or a camera such as Ring that speaks WebRTC natively) negotiates over the
 * WebSocket API: `camera/webrtc/offer` is a subscription that sends back a session id, the
 * answer and ICE candidates, and `camera/webrtc/candidate` passes the display's candidates
 * the other way. The display only ever talks to this server, so it never needs HA's address
 * or token. One session at a time: a new offer ends the one before, and every session ends
 * after `HA_STREAM_MAX_SECONDS`.
 */
import { randomUUID } from 'node:crypto';
import type {
  WebRtcCandidate,
  WebRtcCandidatesResponse,
  WebRtcOfferResponse,
} from '@mantel/shared';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import type { HaClient } from './home-client.js';

export type WebRtcClient = Pick<HaClient, 'subscribe' | 'request'>;

export interface WebRtcOptions {
  /** Every session ends after this long. */
  maxSeconds: number;
  /** How long Home Assistant has to answer an offer. */
  answerTimeoutMs?: number;
  /** After the answer, wait this long for the first candidates so most arrive in one reply. */
  settleMs?: number;
}

interface Session {
  id: string;
  entityId: string;
  /** Home Assistant's own id, from its `session` event. */
  haSession?: string;
  queue: WebRtcCandidate[];
  closed: boolean;
  error?: string;
  close: () => void;
}

/** HA 2024.11 sent candidates as strings; later versions send `RTCIceCandidateInit`. */
export function toCandidate(raw: unknown): WebRtcCandidate | null {
  if (typeof raw === 'string') return raw ? { candidate: raw, sdpMLineIndex: 0 } : null;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.candidate !== 'string') return null;
  return {
    candidate: c.candidate,
    sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid : ((c.sdp_mid as string | undefined) ?? null),
    sdpMLineIndex:
      typeof c.sdpMLineIndex === 'number'
        ? c.sdpMLineIndex
        : typeof c.sdp_m_line_index === 'number'
          ? c.sdp_m_line_index
          : null,
  };
}

export class WebRtcSessions {
  private current: Session | null = null;

  constructor(
    private readonly client: WebRtcClient,
    private readonly opts: WebRtcOptions,
  ) {}

  /** The live session, for tests and status. */
  get active(): { id: string; entityId: string } | null {
    const s = this.current;
    return s && !s.closed ? { id: s.id, entityId: s.entityId } : null;
  }

  async offer(entityId: string, sdp: string): Promise<WebRtcOfferResponse> {
    // One live stream at a time, across every display.
    this.closeAll();
    const id = randomUUID();
    let resolveAnswer!: (sdp: string) => void;
    let rejectAnswer!: (err: Error) => void;
    const answer = new Promise<string>((res, rej) => {
      resolveAnswer = res;
      rejectAnswer = rej;
    });
    // Closing rejects it; nobody may be waiting by then.
    answer.catch(() => {});
    const timers: { cap?: NodeJS.Timeout } = {};
    let sub: { close: () => void } | null = null;
    const session: Session = {
      id,
      entityId,
      queue: [],
      closed: false,
      close: () => {
        if (session.closed) return;
        session.closed = true;
        clearTimeout(timers.cap);
        sub?.close();
        rejectAnswer(new HttpError('upstream_error', session.error ?? 'live view closed'));
        // It stays `current` (closed) so a poll can still say why it ended.
      },
    };
    this.current = session;

    const onEvent = (raw: unknown) => {
      if (raw === null) {
        session.error ??= 'Lost the connection to Home Assistant';
        session.close();
        return;
      }
      const ev = (raw ?? {}) as Record<string, unknown>;
      switch (ev.type) {
        case 'session':
          if (typeof ev.session_id === 'string') session.haSession = ev.session_id;
          return;
        case 'answer':
          if (typeof ev.answer === 'string') resolveAnswer(ev.answer);
          return;
        case 'candidate': {
          const c = toCandidate(ev.candidate);
          if (c) session.queue.push(c);
          return;
        }
        case 'error':
          session.error = `Home Assistant: ${String(ev.message ?? ev.code ?? 'WebRTC failed')}`;
          rejectAnswer(new HttpError('upstream_error', session.error));
          session.close();
          return;
      }
    };

    try {
      sub = await this.client.subscribe(
        { type: 'camera/webrtc/offer', entity_id: entityId, offer: sdp },
        onEvent,
      );
    } catch (err) {
      session.closed = true;
      if (this.current === session) this.current = null;
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpError(
        'upstream_error',
        `Home Assistant has no live video for this camera: ${msg}`,
      );
    }
    if (session.closed) {
      sub.close();
      throw new HttpError('upstream_error', session.error ?? 'live view closed');
    }
    timers.cap = setTimeout(() => {
      log.debug('home: WebRTC session reached HA_STREAM_MAX_SECONDS', { entityId });
      session.close();
    }, this.opts.maxSeconds * 1000);
    timers.cap.unref();

    const waited = setTimeout(() => {
      session.error ??= 'Home Assistant did not answer the live-video offer in time';
      session.close();
    }, this.opts.answerTimeoutMs ?? 8000);
    let sdpAnswer: string;
    try {
      sdpAnswer = await answer;
    } finally {
      clearTimeout(waited);
    }
    await new Promise((r) => setTimeout(r, this.opts.settleMs ?? 300));
    return {
      session: id,
      answer: sdpAnswer,
      candidates: session.queue.splice(0),
      expiresAt: new Date(Date.now() + this.opts.maxSeconds * 1000).toISOString(),
    };
  }

  private find(entityId: string, id: string): Session {
    const s = this.current;
    if (!s || s.id !== id || s.entityId !== entityId)
      throw new HttpError('not_found', 'That live view has ended');
    return s;
  }

  async candidate(entityId: string, id: string, candidate: WebRtcCandidate): Promise<void> {
    const s = this.find(entityId, id);
    if (s.closed) throw new HttpError('not_found', 'That live view has ended');
    if (!s.haSession) return; // Too early; the offer's own SDP carries the first candidates.
    const send = (c: unknown) =>
      this.client.request({
        type: 'camera/webrtc/candidate',
        entity_id: entityId,
        session_id: s.haSession,
        candidate: c,
      });
    try {
      await send({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      });
    } catch {
      // Home Assistant 2024.11 took the candidate line on its own.
      await send(candidate.candidate).catch((err: unknown) => {
        throw new HttpError(
          'upstream_error',
          `Home Assistant: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  poll(entityId: string, id: string): WebRtcCandidatesResponse {
    const s = this.current;
    if (!s || s.id !== id || s.entityId !== entityId)
      return { candidates: [], closed: true, error: 'That live view has ended' };
    return {
      candidates: s.queue.splice(0),
      closed: s.closed,
      ...(s.error ? { error: s.error } : {}),
    };
  }

  close(entityId: string, id: string): void {
    const s = this.current;
    if (s && s.id === id && s.entityId === entityId) s.close();
  }

  closeAll(): void {
    this.current?.close();
  }
}
