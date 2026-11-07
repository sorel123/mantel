import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebRtcSessions, toCandidate, type WebRtcClient } from './home-webrtc.js';

/** A client whose offer subscription we drive by hand. */
function fakeClient() {
  let emit: (e: unknown) => void = () => {};
  const closed: number[] = [];
  const client: WebRtcClient = {
    subscribe: vi.fn(async (_payload, onEvent) => {
      emit = onEvent;
      return { close: () => closed.push(1) };
    }) as WebRtcClient['subscribe'],
    request: vi.fn(async () => null) as WebRtcClient['request'],
  };
  return { client, emit: (e: unknown) => emit(e), closed };
}

describe('WebRTC sessions', () => {
  afterEach(() => vi.useRealTimers());

  it('reads candidates in either of the shapes Home Assistant has sent', () => {
    expect(toCandidate('candidate:1')).toEqual({ candidate: 'candidate:1', sdpMLineIndex: 0 });
    expect(toCandidate({ candidate: 'c', sdp_mid: '0', sdp_m_line_index: 1 })).toEqual({
      candidate: 'c',
      sdpMid: '0',
      sdpMLineIndex: 1,
    });
    expect(toCandidate({})).toBeNull();
    expect(toCandidate('')).toBeNull();
  });

  it('ends a session after the stream cap', async () => {
    vi.useFakeTimers();
    const f = fakeClient();
    const sessions = new WebRtcSessions(f.client, { maxSeconds: 10, settleMs: 0 });
    const pending = sessions.offer('camera.door', 'v=0');
    await vi.advanceTimersByTimeAsync(0);
    f.emit({ type: 'session', session_id: 's1' });
    f.emit({ type: 'answer', answer: 'v=0 answer' });
    const res = await vi.advanceTimersByTimeAsync(1).then(() => pending);
    expect(sessions.active?.id).toBe(res.session);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sessions.active).toBeNull();
    expect(f.closed).toHaveLength(1);
    expect(sessions.poll('camera.door', res.session).closed).toBe(true);
  });

  it('gives up when Home Assistant never answers', async () => {
    vi.useFakeTimers();
    const f = fakeClient();
    const sessions = new WebRtcSessions(f.client, { maxSeconds: 60, answerTimeoutMs: 3000 });
    const pending = sessions.offer('camera.door', 'v=0');
    const check = expect(pending).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(3000);
    await check;
    expect(sessions.active).toBeNull();
  });

  it('ends the session when the connection to Home Assistant drops', async () => {
    const f = fakeClient();
    const sessions = new WebRtcSessions(f.client, { maxSeconds: 60, settleMs: 0 });
    const pending = sessions.offer('camera.door', 'v=0');
    await Promise.resolve();
    f.emit({ type: 'answer', answer: 'a' });
    const res = await pending;
    f.emit(null);
    expect(sessions.poll('camera.door', res.session)).toMatchObject({
      closed: true,
      error: 'Lost the connection to Home Assistant',
    });
  });
});
