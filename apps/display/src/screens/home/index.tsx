import type { HomeEntity } from '@mantel/shared';
import { useCallback, useEffect } from 'react';
import { useNow } from '../../app/Clock';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { SheetHeader, useOverlay } from '../../app/overlay';
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
  const overlay = useOverlay();
  const { data } = home;

  // Locks and garage doors ask first, through the shell's dialog.
  const confirm = useCallback(
    (req: ConfirmRequest) => {
      void overlay
        .confirm({
          title: req.title,
          body: req.body,
          confirmLabel: req.yes,
          cancelLabel: req.no,
          danger: true,
        })
        .then((ok) => ok && req.onYes());
    },
    [overlay],
  );

  // A refused call shows as a toast rather than a card of its own.
  const { notice } = home;
  const { toast } = overlay;
  useEffect(() => {
    if (notice) toast(notice, { tone: 'warn' });
  }, [notice, toast]);

  const announce = () => {
    if (!data) return;
    const targets = data.announceTargets;
    overlay.openSheet(
      (close) => (
        <>
          <SheetHeader title="Announce" onClose={close} />
          <AnnounceSheet targets={targets} onSend={home.announce} onClose={close} />
        </>
      ),
      { wide: true, label: 'Announce' },
    );
  };

  return (
    <div className="home">
      <h1 className="sr-only">Home</h1>
      {!data ? (
        <div className="card hm-empty">
          {home.notSetUp ? (
            <EmptyState
              icon={EmptyIcon.home}
              action="Connect Home Assistant"
              section="homeassistant"
            >
              Home Assistant isn't connected yet.
            </EmptyState>
          ) : home.error ? (
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
              <button className="hm-scene hm-announce-btn" onClick={announce}>
                <Icon name="speaker" />
                Announce
              </button>
            )}
          </div>
          <Body data={data} home={home} now={now} confirm={confirm} showMedia={flags.media} />
        </>
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
