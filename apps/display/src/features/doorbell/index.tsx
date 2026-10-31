import { useCallback, useEffect, useRef, useState } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { useServerEvent } from '../../lib/events';
import './doorbell.css';
import { closeLive, extendLive, openLive, useLiveView, type LiveView } from './store';
import { cameraUrl } from './urls';

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

function LivePopover({ view, leaving }: { view: LiveView; leaving: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [fallback, setFallback] = useState(false);
  const [tick, setTick] = useState(0);
  const total = useRef(view.until - Date.now());

  useEffect(() => {
    total.current = Math.max(1000, view.until - Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [view.until]);

  // Some cameras have no MJPEG stream; refresh stills instead.
  useEffect(() => {
    if (!fallback) return;
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [fallback]);

  const left = Math.max(0, Math.ceil((view.until - now) / 1000));
  const frac = Math.max(0, Math.min(1, (view.until - now) / total.current));
  // Dropping `src` while leaving ends the MJPEG request; browsers can keep it open otherwise.
  const src = leaving
    ? undefined
    : fallback
      ? cameraUrl(view.cameraId, 'snapshot', tick)
      : cameraUrl(view.cameraId, 'stream', view.seq);
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
        <div className="doorbell-video">
          <img
            key={`${view.cameraId}-${fallback ? 'still' : 'live'}`}
            src={src}
            alt={`${view.name} camera`}
            onError={(ev) => ev.currentTarget.getAttribute('src') && setFallback(true)}
          />
          <span className="doorbell-live">
            <i />
            Live
          </span>
        </div>
        <div className="doorbell-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${frac})` }} />
        </div>
        <div className="doorbell-btns">
          <button onClick={closeLive}>Dismiss</button>
          <button className="go" onClick={() => extendLive(30)}>
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}
