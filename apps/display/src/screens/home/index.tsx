import type { HomeEntity } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNow } from '../../app/Clock';
import { useBootstrap } from '../../lib/bootstrap';
import { AnnounceSheet } from './Announce';
import { CamerasCard } from './Cameras';
import { ClimateCard } from './Climate';
import { activeScene, presenceLines } from './format';
import './home.css';
import { Icon, sceneIcon } from './icons';
import { NowPlayingCard } from './NowPlaying';
import { RoomCard, type ConfirmRequest } from './Rooms';
import { useHome, type HomeData } from './useHome';

/**
 * The Home screen: who is home, scene chips, a card per room, the thermostats, the Ring
 * cameras and the Apple TV, all from Home Assistant through the server's allow-list.
 */
export function HomeScreen() {
  const { flags, people } = useBootstrap();
  const home = useHome(flags.media);
  const now = useNow(30_000);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const { data } = home;

  return (
    <div className="home">
      <h1 className="sr-only">Home</h1>
      {!data ? (
        <div className="card hm-empty">
          {home.error ? (
            <>
              <p>Home Assistant isn't answering: {home.error}</p>
              <button onClick={() => void home.reload()}>Try again</button>
            </>
          ) : (
            <span className="eyebrow">Loading</span>
          )}
        </div>
      ) : (
        <>
          <div className="hm-top">
            {data.presence.length > 0 && <PresenceCard data={data} people={people} now={now} />}
            <Scenes data={data} call={home.call} now={now} />
            {flags.alexaAnnouncements && data.announceTargets.length > 0 && (
              <button className="hm-scene hm-announce-btn" onClick={() => setAnnouncing(true)}>
                <Icon name="speaker" />
                Announce
              </button>
            )}
          </div>
          <Body data={data} home={home} now={now} confirm={setConfirm} showMedia={flags.media} />
        </>
      )}

      {home.notice && (
        <div className="hm-notice" role="alert">
          {home.notice}
        </div>
      )}
      {confirm && <Confirm req={confirm} onClose={() => setConfirm(null)} />}
      {announcing && data && (
        <AnnounceSheet
          targets={data.announceTargets}
          onSend={home.announce}
          onClose={() => setAnnouncing(false)}
        />
      )}
    </div>
  );
}

function PresenceCard({
  data,
  people,
  now,
}: {
  data: HomeData;
  people: ReturnType<typeof useBootstrap>['people'];
  now: Date;
}) {
  const { headline, detail } = presenceLines(data.presence, people, now);
  return (
    <div className="card hm-presence">
      <div className="hm-avs">
        {data.presence.map((p) => {
          const person = people.find((x) => x.id === p.personId);
          return (
            <span
              key={p.personId}
              className={`hm-av${p.home ? '' : ' away'}`}
              style={{ '--pc': person?.color ?? 'var(--ink-3)' } as React.CSSProperties}
              title={person?.name ?? p.personId}
            >
              {person?.initial ?? p.personId.slice(0, 1).toUpperCase()}
            </span>
          );
        })}
      </div>
      <div className="who">
        <b>{headline}</b>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

function Scenes({
  data,
  call,
  now,
}: {
  data: HomeData;
  call: ReturnType<typeof useHome>['call'];
  now: Date;
}) {
  const scenes = [...data.entities.values()].filter((e) => e.kind === 'scene');
  const active = activeScene(scenes, now);
  if (!scenes.length) return <div />;
  return (
    <div className="hm-scenes" role="group" aria-label="Scenes">
      {scenes.map((s) => (
        <button
          key={s.id}
          className={`hm-scene${s.id === active ? ' on' : ''}`}
          aria-pressed={s.id === active}
          disabled={s.state === 'unavailable'}
          onClick={() =>
            void call(s, 'turn_on', undefined, { lastChanged: new Date().toISOString() })
          }
        >
          <Icon name={sceneIcon(s.name, s.attrs.icon)} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

function Body({
  data,
  home,
  now,
  confirm,
  showMedia,
}: {
  data: HomeData;
  home: ReturnType<typeof useHome>;
  now: Date;
  confirm: (r: ConfirmRequest) => void;
  showMedia: boolean;
}) {
  const all = [...data.entities.values()];
  const climates = all.filter((e) => e.kind === 'climate');
  const cameras = all.filter((e) => e.kind === 'camera');
  const rooms = data.areas
    .map((area) => ({
      area,
      entities: area.entityIds
        .map((id) => data.entities.get(id))
        .filter(
          (e): e is HomeEntity =>
            !!e && e.kind !== 'climate' && e.kind !== 'camera' && e.kind !== 'scene',
        ),
    }))
    .filter((r) => r.entities.length > 0);
  const players = showMedia ? home.players : [];
  const rail = cameras.length > 0 || players.length > 0;

  return (
    <div className={`hm-main${rail ? '' : ' no-rail'}`}>
      <div className="hm-rooms">
        {climates.length > 0 && <ClimateCard entities={climates} call={home.call} />}
        {rooms.map(({ area, entities }) => (
          <RoomCard
            key={area.id}
            area={area}
            entities={entities}
            call={home.call}
            confirm={confirm}
            now={now}
          />
        ))}
        {!rooms.length && !climates.length && (
          <div className="card hm-empty">
            <p>Nothing from Home Assistant is on the allow-list yet.</p>
          </div>
        )}
      </div>
      {rail && (
        <aside className="hm-rail">
          <CamerasCard cameras={cameras} />
          <NowPlayingCard players={players} onAction={home.mediaCall} />
        </aside>
      )}
    </div>
  );
}

/** Local confirm dialog in the mockup's style, until the shell's primitive lands. */
function Confirm({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  const close = useCallback(onClose, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <>
      <div className="hm-scrim" onClick={close} />
      <div
        className="hm-dialog hm-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hm-confirm-title"
      >
        <h3 id="hm-confirm-title">{req.title}</h3>
        <p>{req.body}</p>
        <div className="btns">
          <button onClick={close} autoFocus>
            {req.no}
          </button>
          <button
            className="go"
            onClick={() => {
              req.onYes();
              close();
            }}
          >
            {req.yes}
          </button>
        </div>
      </div>
    </>
  );
}
