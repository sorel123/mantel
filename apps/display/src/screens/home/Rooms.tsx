import type { HomeArea, HomeEntity } from '@mantel/shared';
import { useEffect, useRef, useState } from 'react';
import {
  dimmable,
  fmtTime,
  isOn,
  isUnavailable,
  lightCaps,
  lightCss,
  sensorValue,
  toPct,
} from './format';
import { Icon } from './icons';
import type { CallFn } from './useHome';

export interface ConfirmRequest {
  title: string;
  body: string;
  yes: string;
  no: string;
  onYes: () => void;
}

interface RowProps {
  e: HomeEntity;
  call: CallFn;
}

const readOnly = (e: HomeEntity) => e.attrs.read_only === true || isUnavailable(e);

/** A room: lights and plugs with switches, locks and covers, then sensor rows. */
export function RoomCard({
  area,
  entities,
  call,
  confirm,
  now,
  onColor,
}: {
  area: HomeArea;
  entities: HomeEntity[];
  call: CallFn;
  confirm: (req: ConfirmRequest) => void;
  now: Date;
  /** Opens the colour sheet for a colour or tunable-white light. */
  onColor?: (e: HomeEntity) => void;
}) {
  const switches = entities.filter((e) => e.kind === 'light' || e.kind === 'switch');
  const locks = entities.filter((e) => e.kind === 'lock');
  const covers = entities.filter((e) => e.kind === 'cover');
  const sensors = entities.filter((e) => e.kind === 'sensor');
  const lit = switches.filter(isOn).length;

  let status = '';
  const lock = locks[0];
  if (lock) status = lockStatus(lock);
  else if (switches.length) status = lit ? `${lit} on` : 'All off';

  return (
    <div className="card hm-room">
      <div className="hm-rh">
        <span className="nm">{area.name}</span>
        <span className="st">{status}</span>
      </div>
      {switches.map((e) =>
        e.kind === 'light' ? (
          <LightRow key={e.id} e={e} call={call} onColor={onColor} />
        ) : (
          <SwitchRow key={e.id} e={e} call={call} />
        ),
      )}
      {locks.map((e) => (
        <LockButton key={e.id} e={e} call={call} confirm={confirm} />
      ))}
      {covers.map((e) => (
        <CoverRow key={e.id} e={e} call={call} confirm={confirm} />
      ))}
      {sensors.length > 0 && (
        <div className="hm-sens">
          {sensors.map((e) => {
            const v = sensorValue(e, now);
            return (
              <div key={e.id} className={isUnavailable(e) ? 'na' : undefined}>
                <span>
                  <i className={`dot${v.warn ? ' warn' : ''}`} />
                  {e.name}
                </span>
                <b className="tnum">{v.text}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lockStatus(e: HomeEntity): string {
  const at = e.lastChanged ? new Date(e.lastChanged) : null;
  const when = at && at.toDateString() === new Date().toDateString() ? ` since ${fmtTime(at)}` : '';
  switch (e.state) {
    case 'locked':
      return `Locked${when}`;
    case 'unlocked':
      return `Unlocked${when}`;
    case 'jammed':
      return 'Jammed';
    case 'locking':
      return 'Locking…';
    case 'unlocking':
      return 'Unlocking…';
    default:
      return isUnavailable(e) ? 'Unavailable' : e.state;
  }
}

function Switch({ on }: { on: boolean }) {
  return <span className={`hm-sw${on ? ' on' : ''}`} aria-hidden="true" />;
}

function SwitchRow({ e, call }: RowProps) {
  const on = isOn(e);
  return (
    <div className={`hm-light${on ? '' : ' off'}${isUnavailable(e) ? ' na' : ''}`}>
      <button
        className="hm-lr"
        role="switch"
        aria-checked={on}
        aria-label={e.name}
        disabled={readOnly(e)}
        onClick={() =>
          call(e, on ? 'turn_off' : 'turn_on', undefined, { state: on ? 'off' : 'on' })
        }
      >
        <span>{e.name}</span>
        <Switch on={on} />
      </button>
    </div>
  );
}

const SLIDER_SETTLE_MS = 250;

function LightRow({ e, call, onColor }: RowProps & { onColor?: (e: HomeEntity) => void }) {
  const on = isOn(e);
  const pct = toPct(e.attrs.brightness);
  const remembered = useRef(pct ?? 60);
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (pct) remembered.current = pct;
  }, [pct]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = drag ?? pct ?? remembered.current;
  const canDim = dimmable(e);
  const caps = lightCaps(e);
  const colorful = !!onColor && (caps.color || caps.white);

  const toggle = () =>
    call(e, on ? 'turn_off' : 'turn_on', undefined, {
      state: on ? 'off' : 'on',
      attrs: { brightness: on ? null : Math.round(remembered.current * 2.55) },
    });

  const slide = (v: number) => {
    setDrag(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void call(
        e,
        'turn_on',
        { brightness_pct: v },
        {
          state: 'on',
          attrs: { brightness: Math.round(v * 2.55) },
        },
      ).finally(() => setDrag(null));
    }, SLIDER_SETTLE_MS);
  };

  return (
    <div className={`hm-light${on ? '' : ' off'}${isUnavailable(e) ? ' na' : ''}`}>
      <button
        className="hm-lr"
        role="switch"
        aria-checked={on}
        aria-label={e.name}
        disabled={readOnly(e)}
        onClick={toggle}
      >
        <span>{e.name}</span>
        <Switch on={on} />
      </button>
      {(canDim || colorful) && (
        <div className="hm-lctl">
          {canDim && (
            <input
              className="hm-bri"
              type="range"
              min={1}
              max={100}
              value={value}
              disabled={readOnly(e) || !on}
              style={{ '--v': `${value}%` } as React.CSSProperties}
              aria-label={`${e.name} brightness`}
              onChange={(ev) => slide(Number(ev.target.value))}
            />
          )}
          {colorful && (
            <button
              type="button"
              className={`hm-lcolor${on ? '' : ' off'}`}
              style={{ '--lc': lightCss(e) ?? 'var(--surface-2)' } as React.CSSProperties}
              disabled={readOnly(e)}
              aria-label={`${e.name} colour`}
              onClick={() => onColor?.(e)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LockButton({ e, call, confirm }: RowProps & { confirm: (req: ConfirmRequest) => void }) {
  const locked = e.state === 'locked' || e.state === 'locking';
  const press = () => {
    if (!locked) {
      void call(e, 'lock', undefined, { state: 'locking' });
      return;
    }
    confirm({
      title: `Unlock the ${e.name.toLowerCase()}?`,
      body: 'Anyone can open it until it is locked again.',
      yes: 'Unlock',
      no: 'Keep locked',
      onYes: () => void call(e, 'unlock', undefined, { state: 'unlocking' }),
    });
  };
  return (
    <button
      className={`hm-lock${locked ? ' locked' : ''}`}
      disabled={readOnly(e)}
      onClick={press}
      aria-label={`${e.name}: ${lockStatus(e)}`}
    >
      <Icon name={locked ? 'lock' : 'unlock'} />
      <span>{locked ? 'Locked' : e.state === 'jammed' ? 'Jammed' : 'Unlocked'}</span>
    </button>
  );
}

function CoverRow({ e, call, confirm }: RowProps & { confirm: (req: ConfirmRequest) => void }) {
  const open = e.state === 'open' || e.state === 'opening';
  const moving = e.state === 'opening' || e.state === 'closing';
  const label =
    { open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' }[e.state] ??
    (isUnavailable(e) ? 'Unavailable' : e.state);
  const press = () => {
    if (open) {
      void call(e, 'close_cover', undefined, { state: 'closing' });
      return;
    }
    confirm({
      title: `Open the ${e.name.toLowerCase()}?`,
      body: 'Check that the way is clear.',
      yes: 'Open',
      no: 'Keep closed',
      onYes: () => void call(e, 'open_cover', undefined, { state: 'opening' }),
    });
  };
  return (
    <div className="hm-cover">
      <Icon name="garage" />
      <span>
        {e.name}
        <em>{label}</em>
      </span>
      {e.attrs.read_only !== true && (
        <button disabled={readOnly(e) || moving} onClick={press}>
          {open ? 'Close' : 'Open'}
        </button>
      )}
    </div>
  );
}
