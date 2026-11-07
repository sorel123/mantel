/**
 * Live camera video over WebRTC (v3 workstream H). The display never talks to Home Assistant:
 * it hands its offer to the Mantel server, which runs HA's `camera/webrtc/offer` subscription
 * and passes the answer and ICE candidates back and forth. One live session at a time.
 */
import { z } from 'zod';

/** An ICE candidate as `RTCIceCandidateInit`. */
export const WebRtcCandidate = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});
export type WebRtcCandidate = z.infer<typeof WebRtcCandidate>;

export const WebRtcOfferRequest = z.object({ offer: z.string().min(1).max(64_000) });
export const WebRtcOfferResponse = z.object({
  /** Mantel's id for the session; the other routes take it. */
  session: z.string(),
  answer: z.string(),
  /** Candidates Home Assistant sent with or just after the answer. */
  candidates: z.array(WebRtcCandidate),
  /** When the server ends the session by itself (`HA_STREAM_MAX_SECONDS`). */
  expiresAt: z.string(),
});
export type WebRtcOfferResponse = z.infer<typeof WebRtcOfferResponse>;

export const WebRtcCandidateRequest = z.object({ candidate: WebRtcCandidate });
export const WebRtcCandidatesResponse = z.object({
  /** Candidates from Home Assistant since the last poll. */
  candidates: z.array(WebRtcCandidate),
  /** True once the session has ended (closed, replaced by another, timed out or failed). */
  closed: z.boolean(),
  error: z.string().optional(),
});
export type WebRtcCandidatesResponse = z.infer<typeof WebRtcCandidatesResponse>;
export const WebRtcOk = z.object({ ok: z.literal(true) });

/**
 * What mock mode answers: not a usable description, so the display's WebRTC attempt fails
 * at once and the live view falls back to the MJPEG stream, as it would with an older
 * Home Assistant.
 */
export const MOCK_WEBRTC_ANSWER = 'v=0\r\ns=mantel-mock-webrtc-fallback\r\n';
