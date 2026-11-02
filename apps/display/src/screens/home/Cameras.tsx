import type { HomeEntity } from '@mantel/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { cameraUrl, openLive, rememberCameraNames } from '../../features/doorbell';
import { Icon } from './icons';

/** Stills refresh this often while the Home screen is up. */
const REFRESH_MS = 30_000;

function useTick() {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / REFRESH_MS));
  useEffect(() => {
    const t = setInterval(() => setTick(Math.floor(Date.now() / REFRESH_MS)), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  return tick;
}

/**
 * Ring cameras, in the household's order. `feature`: the first large and the rest as
 * thumbnails; `grid`: equal tiles. Tap any for 30 s of live view. While arranging, `tools`
 * draws each camera's move and hide buttons over its tile instead.
 */
export function CamerasCard({
  cameras,
  style = 'feature',
  title,
  tools,
}: {
  cameras: HomeEntity[];
  style?: 'feature' | 'grid';
  /** A single camera card shows its name above the picture. */
  title?: string;
  tools?: (cam: HomeEntity, index: number) => ReactNode;
}) {
  const tick = useTick();
  useEffect(() => {
    rememberCameraNames(cameras);
  }, [cameras]);
  if (!cameras.length) return null;
  const [main, ...rest] = cameras as [HomeEntity, ...HomeEntity[]];
  const tile = (c: HomeEntity, i: number, big?: boolean) => (
    <Tile key={c.id} cam={c} tick={tick} big={big} tools={tools?.(c, i)} />
  );
  return (
    <div
      className={`card hm-cams${style === 'grid' ? ' grid' : ''}${title ? ' single' : ''}`}
      role="group"
      aria-label={title ? `${title} camera, tap for live view` : 'Cameras, tap one for live view'}
    >
      {style === 'grid' ? (
        <div className={`hm-thumbs n${Math.min(cameras.length, 4)}`}>
          {cameras.map((c, i) => tile(c, i))}
        </div>
      ) : (
        <>
          {tile(main, 0, true)}
          {rest.length > 0 && <div className="hm-thumbs">{rest.map((c, i) => tile(c, i + 1))}</div>}
        </>
      )}
    </div>
  );
}

function Tile({
  cam,
  tick,
  big,
  tools,
}: {
  cam: HomeEntity;
  tick: number;
  big?: boolean;
  tools?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tick]);
  const off = cam.state === 'unavailable';
  const picture =
    !failed && !off ? (
      <img src={cameraUrl(cam.id, 'snapshot', tick)} alt="" onError={() => setFailed(true)} />
    ) : (
      <span className="hm-cam-empty">
        <Icon name="camera" />
      </span>
    );
  if (tools)
    return (
      <div className={`hm-cam${big ? ' big' : ''} arranging`}>
        {picture}
        <span className="hm-cam-name">{cam.name}</span>
        {tools}
      </div>
    );
  return (
    <button
      className={`hm-cam${big ? ' big' : ''}`}
      onClick={() => openLive(cam.id, 'tap', 30)}
      aria-label={`${cam.name} camera, open live view`}
      disabled={off}
    >
      {picture}
      <span className="hm-cam-name">{cam.name}</span>
    </button>
  );
}
