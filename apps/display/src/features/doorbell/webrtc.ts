/**
 * Full-motion live view over WebRTC. The offer, answer and ICE candidates go through the
 * Mantel server (which talks to Home Assistant), never straight to HA. The caller gives up
 * after `WEBRTC_DEADLINE_MS` and falls back to the MJPEG stream and stills.
 */
import type { WebRtcCandidate } from '@mantel/shared';
import { api } from '../../lib/api';

/** How long WebRTC gets to show a picture before the live view falls back. */
export const WEBRTC_DEADLINE_MS = 3000;
const GATHER_MS = 800;
const POLL_MS = 400;

export const webRtcAvailable = () => typeof globalThis.RTCPeerConnection === 'function';

/** Wait for the browser to finish gathering its own candidates, briefly. */
function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

const addAll = async (pc: RTCPeerConnection, list: WebRtcCandidate[]) => {
  for (const c of list) await pc.addIceCandidate(c).catch(() => {});
};

/**
 * Start a session for `cameraId` and play it in `video`. Resolves with a stop function once
 * the video is playing; rejects (and cleans up) on any failure or when `signal` aborts.
 * `onEnd` is called if a playing session drops later.
 */
export async function playWebRtc(
  cameraId: string,
  video: HTMLVideoElement,
  signal: AbortSignal,
  onEnd: () => void,
): Promise<() => void> {
  if (!webRtcAvailable()) throw new Error('WebRTC is not available in this browser');
  const pc = new RTCPeerConnection();
  let session: string | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    pc.close();
    video.srcObject = null;
    if (session)
      void api
        .call('cameraWebrtcClose', { params: { id: cameraId, session } })
        .catch(() => undefined);
  };
  const aborted = () => stop();
  signal.addEventListener('abort', aborted, { once: true });
  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const stream = new MediaStream();
    pc.ontrack = (ev) => {
      stream.addTrack(ev.track);
      video.srcObject = stream;
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, GATHER_MS);
    if (signal.aborted) throw new Error('cancelled');

    const res = await api.call('cameraWebrtcOffer', {
      params: { id: cameraId },
      body: { offer: pc.localDescription?.sdp ?? '' },
    });
    session = res.session;
    if (signal.aborted) throw new Error('cancelled');
    await pc.setRemoteDescription({ type: 'answer', sdp: res.answer });
    await addAll(pc, res.candidates);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !session || stopped) return;
      void api
        .call('cameraWebrtcCandidate', {
          params: { id: cameraId, session },
          body: { candidate: ev.candidate.toJSON() as WebRtcCandidate },
        })
        .catch(() => undefined);
    };

    // Home Assistant may still trickle candidates; fetch them until the picture arrives.
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (err?: Error) => {
        clearTimeout(timer);
        video.removeEventListener('playing', playing);
        signal.removeEventListener('abort', cancel);
        if (err) reject(err);
        else resolve();
      };
      const playing = () => finish();
      const cancel = () => finish(new Error('cancelled'));
      video.addEventListener('playing', playing);
      signal.addEventListener('abort', cancel, { once: true });
      const poll = async () => {
        if (stopped || !session) return;
        try {
          const next = await api.call('cameraWebrtcCandidates', {
            params: { id: cameraId, session },
          });
          await addAll(pc, next.candidates);
          if (next.closed) return finish(new Error(next.error ?? 'live view ended'));
        } catch (err) {
          return finish(err instanceof Error ? err : new Error(String(err)));
        }
        if (pc.connectionState === 'failed') return finish(new Error('connection failed'));
        timer = setTimeout(() => void poll(), POLL_MS);
      };
      timer = setTimeout(() => void poll(), POLL_MS);
      void video.play().catch(() => undefined);
    });

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (!stopped) {
          stop();
          onEnd();
        }
      }
    };
    signal.removeEventListener('abort', aborted);
    return stop;
  } catch (err) {
    signal.removeEventListener('abort', aborted);
    stop();
    throw err;
  }
}
