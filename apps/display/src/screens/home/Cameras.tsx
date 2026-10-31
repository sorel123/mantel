import type { HomeEntity } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { cameraUrl, openLive, rememberCameraNames } from '../../features/doorbell';
import { Icon } from './icons';

/** Stills refresh this often while the Home screen is up. */
const REFRESH_MS = 30_000;

/** Ring cameras: the doorbell large, the rest as thumbnails. Tap any for 30 s of live view. */
export function CamerasCard({ cameras }: { cameras: HomeEntity[] }) {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / REFRESH_MS));
  useEffect(() => {
    rememberCameraNames(cameras);
  }, [cameras]);
  useEffect(() => {
    const t = setInterval(() => setTick(Math.floor(Date.now() / REFRESH_MS)), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  if (!cameras.length) return null;
  const ordered = [...cameras].sort(
    (a, b) => Number(b.attrs.doorbell === true) - Number(a.attrs.doorbell === true),
  );
  const [main, ...rest] = ordered as [HomeEntity, ...HomeEntity[]];
  return (
    <div className="card hm-cams" role="group" aria-label="Cameras, tap one for live view">
      <Tile cam={main} tick={tick} big />
      {rest.length > 0 && (
        <div className="hm-thumbs">
          {rest.map((c) => (
            <Tile key={c.id} cam={c} tick={tick} />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ cam, tick, big }: { cam: HomeEntity; tick: number; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tick]);
  const off = cam.state === 'unavailable';
  return (
    <button
      className={`hm-cam${big ? ' big' : ''}`}
      onClick={() => openLive(cam.id, 'tap', 30)}
      aria-label={`${cam.name} camera, open live view`}
      disabled={off}
    >
      {!failed && !off ? (
        <img src={cameraUrl(cam.id, 'snapshot', tick)} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="hm-cam-empty">
          <Icon name="camera" />
        </span>
      )}
      <span className="hm-cam-name">{cam.name}</span>
    </button>
  );
}
