import type { HomeCardPlace, HomeEntity, HomeLayout } from '@mantel/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNow } from '../../app/Clock';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { SheetHeader, useOverlay } from '../../app/overlay';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { AnnounceSheet } from './Announce';
import {
  CAMERA_STYLES,
  CAMERAS,
  CLIMATE,
  MEDIA,
  cameraIdOf,
  cameraKey,
  isCamera,
  moveCard,
  patchCard,
  resolveCards,
  roomKey,
  standsAlone,
  switchSide,
  toLayout,
} from './arrange';
import { CamerasCard } from './Cameras';
import { ClimateCard } from './Climate';
import { activeScene, presenceLines } from './format';
import './home.css';
import { Icon, sceneIcon } from './icons';
import { LightColorSheet } from './LightColor';
import { NowPlayingCard } from './NowPlaying';
import { RoomCard, type ConfirmRequest } from './Rooms';
import { useHome, type HomeData } from './useHome';

/**
 * The Home screen: who is home, scene chips, a card per room, the thermostats, the Ring
 * cameras and the Apple TV, all from Home Assistant through the server's allow-list.
 */
export function HomeScreen() {
  const { flags, people, settings } = useBootstrap();
  const [arranging, setArranging] = useState(false);
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
            <div className="hm-actions">
              {flags.alexaAnnouncements && data.announceTargets.length > 0 && (
                <button className="hm-scene hm-announce-btn" onClick={announce}>
                  <Icon name="speaker" />
                  Announce
                </button>
              )}
              {!arranging && (
                <button
                  className="hm-scene hm-arrange-btn"
                  onClick={() => setArranging(true)}
                  aria-label="Arrange the Home screen"
                >
                  <Icon name="grid" />
                  Arrange
                </button>
              )}
            </div>
          </div>
          <Body
            data={data}
            home={home}
            now={now}
            confirm={confirm}
            showMedia={flags.media}
            layout={settings.homeLayout ?? NO_LAYOUT}
            arranging={arranging}
            onArrangeDone={() => setArranging(false)}
          />
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

/** Settings saved before Arrange existed. */
const NO_LAYOUT: HomeLayout = { cards: [], cameraStyle: 'feature' };

interface CardDef {
  key: string;
  label: string;
  render: (cam?: CameraTools) => ReactNode;
}

type CameraTools = (cam: HomeEntity, index: number) => ReactNode;

/** The Home screen's cards in default order, each with how to draw it. */
function useCards({
  data,
  home,
  now,
  confirm,
  showMedia,
  saved,
  onColor,
}: {
  data: HomeData;
  home: ReturnType<typeof useHome>;
  now: Date;
  confirm: (r: ConfirmRequest) => void;
  showMedia: boolean;
  saved: HomeCardPlace[];
  onColor: (e: HomeEntity) => void;
}) {
  const all = [...data.entities.values()];
  const climates = all.filter((e) => e.kind === 'climate');
  // The doorbell first unless the household moved it.
  const cameras = all
    .filter((e) => e.kind === 'camera')
    .sort((a, b) => Number(b.attrs.doorbell === true) - Number(a.attrs.doorbell === true));
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

  const defs: CardDef[] = [];
  if (climates.length)
    defs.push({
      key: CLIMATE,
      label: 'Thermostats',
      render: () => <ClimateCard entities={climates} call={home.call} />,
    });
  for (const { area, entities } of rooms)
    defs.push({
      key: roomKey(area.id),
      label: area.name,
      render: () => (
        <RoomCard
          area={area}
          entities={entities}
          call={home.call}
          confirm={confirm}
          now={now}
          onColor={onColor}
        />
      ),
    });
  const camById = new Map(cameras.map((c) => [c.id, c]));
  if (cameras.length) defs.push({ key: CAMERAS, label: 'Cameras', render: () => null });
  for (const c of cameras)
    defs.push({
      key: cameraKey(c.id),
      label: c.name,
      render: (tools) => <CamerasCard cameras={[c]} title={c.name} tools={tools} />,
    });
  if (players.length)
    defs.push({
      key: MEDIA,
      label: 'Now playing',
      render: () => <NowPlayingCard players={players} onAction={home.mediaCall} />,
    });

  const cards = resolveCards(
    defs.map((d) => d.key),
    saved,
  );
  // The cameras card draws the cameras in the order their own places have.
  const groupCams = (list: HomeCardPlace[]) =>
    list
      .filter((c) => isCamera(c.key) && !c.hidden)
      .map((c) => camById.get(cameraIdOf(c.key)))
      .filter((c): c is HomeEntity => !!c);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return { cards, byKey, groupCams, empty: !rooms.length && !climates.length };
}

function Body({
  data,
  home,
  now,
  confirm,
  showMedia,
  layout,
  arranging,
  onArrangeDone,
}: {
  data: HomeData;
  home: ReturnType<typeof useHome>;
  now: Date;
  confirm: (r: ConfirmRequest) => void;
  showMedia: boolean;
  layout: HomeLayout;
  arranging: boolean;
  onArrangeDone: () => void;
}) {
  const overlay = useOverlay();
  const onColor = useCallback(
    (e: HomeEntity) =>
      overlay.openSheet(
        (close) => (
          <>
            <SheetHeader title={e.name} onClose={close} />
            <LightColorSheet entity={e} call={home.call} />
          </>
        ),
        { label: `${e.name} colour` },
      ),
    [overlay, home.call],
  );
  const [draft, setDraft] = useState<HomeLayout | null>(null);
  useEffect(() => {
    if (arranging) setDraft(structuredClone(layout));
    else setDraft(null);
  }, [arranging, layout]);
  const live = draft ?? layout;
  const style = live.cameraStyle;
  const { cards, byKey, groupCams, empty } = useCards({
    data,
    home,
    now,
    confirm,
    showMedia,
    saved: live.cards,
    onColor,
  });
  const [saving, setSaving] = useState(false);

  const edit = (next: HomeCardPlace[], cameraStyle = style) =>
    setDraft(toLayout(next, cameraStyle));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const current = await api.call('settings');
      await api.call('settingsPut', {
        body: { ...current, homeLayout: toLayout(cards, draft.cameraStyle) },
      });
      // The server reloads every display; this one comes back to Home.
      onArrangeDone();
    } catch (err) {
      overlay.toast(`Could not save the layout: ${err instanceof Error ? err.message : err}`, {
        tone: 'warn',
      });
    } finally {
      setSaving(false);
    }
  };

  const drawn = cards.filter((c) => !c.hidden && standsAlone(c.key, style) && byKey.has(c.key));
  const main = drawn.filter((c) => !c.side);
  const side = drawn.filter((c) => c.side);
  const hasGroupCams = style !== 'cards' && groupCams(cards).length > 0;

  const tools = (c: HomeCardPlace) =>
    arranging ? (
      <CardTools
        label={byKey.get(c.key)?.label ?? c.key}
        side={c.side}
        wide={c.wide}
        onMove={(dir) => edit(moveCard(cards, c.key, dir, style))}
        onSide={() => edit(switchSide(cards, c.key))}
        onWide={c.side ? undefined : () => edit(patchCard(cards, c.key, { wide: !c.wide }))}
        onHide={() => edit(patchCard(cards, c.key, { hidden: true }))}
        vertical={c.side}
      />
    ) : null;

  const camTools: CameraTools | undefined = arranging
    ? (cam) => {
        const key = cameraKey(cam.id);
        return (
          <span className="hm-camtools">
            <button
              type="button"
              aria-label={`Move ${cam.name} earlier`}
              onClick={() => edit(moveCard(cards, key, -1, style))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={`Hide ${cam.name}`}
              onClick={() => edit(patchCard(cards, key, { hidden: true }))}
            >
              Hide
            </button>
            <button
              type="button"
              aria-label={`Move ${cam.name} later`}
              onClick={() => edit(moveCard(cards, key, 1, style))}
            >
              ›
            </button>
          </span>
        );
      }
    : undefined;

  const renderCard = (c: HomeCardPlace) => {
    const def = byKey.get(c.key);
    if (!def) return null;
    const body =
      c.key === CAMERAS ? (
        <CamerasCard
          cameras={groupCams(cards)}
          style={style === 'grid' ? 'grid' : 'feature'}
          tools={camTools}
        />
      ) : (
        def.render(undefined)
      );
    if (c.key === CAMERAS && !hasGroupCams) return null;
    return (
      <div
        key={c.key}
        className={`hm-slot${c.wide && !c.side ? ' wide' : ''}${arranging ? ' arranging' : ''}`}
        data-card={c.key}
      >
        {arranging && <div className="hm-slot-inert">{body}</div>}
        {!arranging && body}
        {tools(c)}
      </div>
    );
  };

  const hidden = cards.filter(
    (c) => c.hidden && byKey.has(c.key) && (c.key !== CAMERAS || style !== 'cards'),
  );
  const rail =
    side.some((c) => c.key !== CAMERAS || hasGroupCams) || (arranging && side.length > 0);

  return (
    <>
      {arranging && (
        <div className="card hm-arrange" role="region" aria-label="Arrange Home">
          <div className="hm-arrange-text">
            <b>Arrange Home</b>
            <span>
              Move cards with the arrows, send them to the side, make them wide or hide them.
            </span>
          </div>
          {byKey.has(CAMERAS) && (
            <div className="hm-camstyle">
              <span className="eyebrow">Cameras</span>
              <div className="seg" role="group" aria-label="Camera layout">
                {CAMERA_STYLES.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="btn sm"
                    aria-pressed={style === o.id}
                    onClick={() => edit(cards, o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="hm-arrange-actions">
            <button type="button" className="btn ghost" onClick={() => edit([], 'feature')}>
              Start over
            </button>
            <button type="button" className="btn ghost" onClick={onArrangeDone} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
      )}
      <div className={`hm-main${rail ? '' : ' no-rail'}`}>
        <div className="hm-rooms">
          {main.map(renderCard)}
          {empty && !main.length && (
            <div className="card hm-empty">
              <p>Nothing from Home Assistant is on the allow-list yet.</p>
            </div>
          )}
          {arranging && hidden.length > 0 && (
            <div className="card hm-hidden">
              <span className="eyebrow">Hidden</span>
              {hidden.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => edit(patchCard(cards, c.key, { hidden: false }))}
                >
                  Show {byKey.get(c.key)?.label ?? c.key}
                </button>
              ))}
            </div>
          )}
        </div>
        {rail && <aside className="hm-rail">{side.map(renderCard)}</aside>}
      </div>
    </>
  );
}

function CardTools({
  label,
  side,
  wide,
  vertical,
  onMove,
  onSide,
  onWide,
  onHide,
}: {
  label: string;
  side: boolean;
  wide: boolean;
  vertical: boolean;
  onMove: (dir: -1 | 1) => void;
  onSide: () => void;
  onWide?: () => void;
  onHide: () => void;
}) {
  return (
    <div className="hm-tools" role="group" aria-label={`Arrange ${label}`}>
      <button type="button" aria-label={`Move ${label} earlier`} onClick={() => onMove(-1)}>
        {vertical ? '↑' : '←'}
      </button>
      <button type="button" aria-label={`Move ${label} later`} onClick={() => onMove(1)}>
        {vertical ? '↓' : '→'}
      </button>
      <button
        type="button"
        aria-label={side ? `Move ${label} to the grid` : `Move ${label} to the side column`}
        onClick={onSide}
      >
        {side ? 'Grid' : 'Side'}
      </button>
      {onWide && (
        <button
          type="button"
          aria-label={`Make ${label} ${wide ? 'one column' : 'two columns'} wide`}
          aria-pressed={wide}
          className={wide ? 'on' : undefined}
          onClick={onWide}
        >
          Wide
        </button>
      )}
      <button type="button" aria-label={`Hide ${label}`} onClick={onHide}>
        Hide
      </button>
    </div>
  );
}
