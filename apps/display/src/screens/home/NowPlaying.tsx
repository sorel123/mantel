import type { MediaAction, MediaPlayer } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { withDeviceKey } from '../../features/doorbell';
import { Icon } from './icons';

const fmtDur = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** Playback position now, counting forward from `updatedAt` while playing. */
export function livePosition(p: MediaPlayer, now: number): number | null {
  if (p.positionSeconds === undefined) return null;
  const since = p.state === 'playing' && p.updatedAt ? (now - Date.parse(p.updatedAt)) / 1000 : 0;
  const pos = p.positionSeconds + Math.max(0, since);
  return p.durationSeconds ? Math.min(p.durationSeconds, pos) : pos;
}

/** Apple TV now playing: artwork, title, progress, and previous / play-pause / next. */
export function NowPlayingCard({
  players,
  onAction,
}: {
  players: MediaPlayer[];
  onAction: (p: MediaPlayer, a: MediaAction) => void;
}) {
  const active = players.filter((p) => p.state === 'playing' || p.state === 'paused');
  const [pick, setPick] = useState<string | null>(null);
  const p =
    active.find((x) => x.id === pick) ??
    active.find((x) => x.state === 'playing') ??
    active[0] ??
    null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (p?.state !== 'playing') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p?.state]);
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => setArtFailed(false), [p?.artworkUrl]);

  if (!players.length) return null;
  if (!p)
    return (
      <div className="card hm-np idle">
        <div className="hm-rh">
          <span className="nm">Now playing</span>
          <span className="st">Nothing on</span>
        </div>
        <p className="hm-np-idle">
          {players.map((x) => x.name).join(' · ')} {players.length === 1 ? 'is' : 'are'} idle.
        </p>
      </div>
    );

  const pos = livePosition(p, now);
  const frac = pos !== null && p.durationSeconds ? pos / p.durationSeconds : null;
  const playing = p.state === 'playing';
  return (
    <div className="card hm-np">
      {active.length > 1 && (
        <div className="hm-np-pick" role="group" aria-label="Apple TVs">
          {active.map((x) => (
            <button key={x.id} aria-pressed={x.id === p.id} onClick={() => setPick(x.id)}>
              {x.name.replace(/\s*Apple TV$/i, '')}
            </button>
          ))}
        </div>
      )}
      <div className="hm-np-body">
        <div className="hm-np-art">
          {p.artworkUrl && !artFailed ? (
            <img src={withDeviceKey(p.artworkUrl)} alt="" onError={() => setArtFailed(true)} />
          ) : (
            <Icon name="tv" />
          )}
        </div>
        <div className="hm-np-meta">
          <div className="eyebrow hm-np-src">
            {[p.app, p.name.replace(/\s*Apple TV$/i, '')].filter(Boolean).join(' · ')}
          </div>
          <div className="hm-np-title">{p.title ?? 'Playing'}</div>
          {p.artist && <div className="hm-np-sub">{p.artist}</div>}
          {frac !== null && pos !== null && (
            <div className="hm-np-prog">
              <div className="bar">
                <i style={{ width: `${Math.min(100, frac * 100)}%` }} />
              </div>
              <span className="tnum">
                {fmtDur(pos)} / {fmtDur(p.durationSeconds!)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="hm-np-ctl">
        <button aria-label="Previous" onClick={() => onAction(p, 'previous')}>
          <Icon name="previous" />
        </button>
        <button
          className="main"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => onAction(p, playing ? 'pause' : 'play')}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button aria-label="Next" onClick={() => onAction(p, 'next')}>
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}
