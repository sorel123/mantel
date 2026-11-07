import { useCallback, useEffect, useRef, useState } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { useServerEvent } from '../../lib/events';
import './doorbell.css';
import { closeLive, extendLive, openLive, useLiveView, type LiveView } from './store';
import { cameraUrl } from './urls';
import { WEBRTC_DEADLINE_MS, playWebRtc, webRtcAvailable } from './webrtc';

export { openLive, closeLive, rememberCameraNames } from './store';
export { cameraUrl, withDeviceKey } from './urls';

/** Milliseconds of a motion token (`--std`), so exits wait for their transition. */
function tokenMs(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : n * 1000;
}

/**
 * The live-view pop-over, over every screen. Mount once inside the scaled panel. It opens on
 * `home.doorbell` (when the doorbell flag is on) and when a camera tile is tapped, shows the
 * live view for its time (30 s by default) with a draining bar, and closes itself.
 */
export function DoorbellLayer() {
  const { flags, settings } = useBootstrap();
  const live = useLiveView();
  const [shown, setShown] = useState<LiveView | null>(live);
  const [leaving, setLeaving] = useState(false);

  useServerEvent(
    'home.doorbell',
    useCallback(
      (p) => {
        if (flags.doorbellPopover) openLive(p.cameraEntityId, 'doorbell', p.durationSeconds);
      },
      [flags.doorbellPopover],
    ),
  );

  // Keep the last view on screen while it animates out.
  useEffect(() => {
    if (live) {
      setShown(live);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const t = setTimeout(
      () => {
        setShown(null);
        setLeaving(false);
      },
      tokenMs('--std', 320),
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Close when the time runs out.
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(closeLive, Math.max(0, live.until - Date.now()));
    return () => clearTimeout(t);
  }, [live]);

  // Home Assistant turned off in Settings: no live view, whatever arrives.
  if (!shown || settings.integrations?.homeassistant?.enabled === false) return null;
  return <LivePopover view={shown} leaving={leaving} />;
}

/**
 * How the picture arrives: WebRTC first (full motion, through the server), the MJPEG stream if
 * that fails within three seconds, and refreshing stills if the stream fails too.
 */
type Mode = 'connecting' | 'video' | 'mjpeg' | 'still';

function LivePopover({ view, leaving }: { view: LiveView; leaving: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<Mode>(() => (webRtcAvailable() ? 'connecting' : 'mjpeg'));
  const [muted, setMuted] = useState(true);
  const [tick, setTick] = useState(0);
  const total = useRef(view.until - Date.now());
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    total.current = Math.max(1000, view.until - Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [view.until]);

  // WebRTC for this camera; one session, ended when the view closes or changes camera.
  useEffect(() => {
    const el = video.current;
    if (!el || !webRtcAvailable() || leaving) return;
    setMode('connecting');
    setMuted(true);
    const ctl = new AbortController();
    let stop: (() => void) | null = null;
    const fallback = () => !ctl.signal.aborted && setMode((m) => (m === 'still' ? m : 'mjpeg'));
    const deadline = setTimeout(() => {
      ctl.abort();
      setMode((m) => (m === 'connecting' ? 'mjpeg' : m));
    }, WEBRTC_DEADLINE_MS);
    playWebRtc(view.cameraId, el, ctl.signal, fallback)
      .then((s) => {
        clearTimeout(deadline);
        if (ctl.signal.aborted) return s();
        stop = s;
        setMode('video');
      })
      .catch(() => {
        clearTimeout(deadline);
        fallback();
      });
    return () => {
      clearTimeout(deadline);
      ctl.abort();
      stop?.();
    };
  }, [view.cameraId, view.seq, leaving]);

  // Some cameras have no MJPEG stream; refresh stills instead.
  useEffect(() => {
    if (mode !== 'still' && mode !== 'connecting') return;
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [mode]);

  const left = Math.max(0, Math.ceil((view.until - now) / 1000));
  const frac = Math.max(0, Math.min(1, (view.until - now) / total.current));
  // Dropping `src` while leaving ends the MJPEG request; browsers can keep it open otherwise.
  const src =
    leaving || mode === 'video'
      ? undefined
      : mode === 'mjpeg'
        ? cameraUrl(view.cameraId, 'stream', view.seq)
        : cameraUrl(view.cameraId, 'snapshot', tick);
  const doorbell = view.reason === 'doorbell';

  return (
    <div className={`doorbell${leaving ? ' leaving' : ''}`}>
      <div className="doorbell-scrim" onClick={closeLive} />
      <div
        className="doorbell-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="doorbell-title"
      >
        <div className="doorbell-head">
          <div>
            <div className="eyebrow">{doorbell ? 'Doorbell' : 'Live view'}</div>
            <h2 className="h2" id="doorbell-title">
              {doorbell ? `Someone's at the ${view.name.toLowerCase()}` : view.name}
            </h2>
          </div>
          <span className="doorbell-left tnum" aria-label={`${left} seconds left`}>
            {left}s
          </span>
        </div>
        <div className={`doorbell-video ${mode}`}>
          {mode !== 'video' && (
            <img
              key={`${view.cameraId}-${mode === 'mjpeg' ? 'live' : 'still'}`}
              src={src}
              alt={`${view.name} camera`}
              onError={(ev) =>
                mode === 'mjpeg' && ev.currentTarget.getAttribute('src') && setMode('still')
              }
            />
          )}
          <video
            ref={video}
            autoPlay
            playsInline
            muted={muted}
            aria-label={mode === 'video' ? `${view.name} camera` : undefined}
            aria-hidden={mode === 'video' ? undefined : true}
          />
          <span className="doorbell-live">
            <i />
            {mode === 'connecting' ? 'Connecting' : 'Live'}
          </span>
        </div>
        <div className="doorbell-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${frac})` }} />
        </div>
        <div className="doorbell-btns">
          <button onClick={closeLive}>Dismiss</button>
          {mode === 'video' && (
            <button
              className="sound"
              aria-pressed={!muted}
              onClick={() => {
                const v = video.current;
                setMuted((m) => !m);
                if (v) {
                  v.muted = !muted;
                  void v.play().catch(() => undefined);
                }
              }}
            >
              {muted ? 'Sound on' : 'Mute'}
            </button>
          )}
          <button className="go" onClick={() => extendLive(30)}>
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}
