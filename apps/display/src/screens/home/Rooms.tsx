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
import {
  DIM_DEBOUNCE_MS,
  LONG_PRESS_MS,
  classify,
  dragPct,
  dragStart,
  type Gesture,
} from './dim';
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

/** A plug or an on/off switch: the same tile as a light, tap only. */
function SwitchRow({ e, call }: RowProps) {
  const on = isOn(e);
  return (
    <div
      className={`hm-tile${on ? ' on' : ' off'}${isUnavailable(e) ? ' na' : ''}`}
      style={{ '--v': on ? '100%' : '0%', '--lc': 'var(--accent)' } as React.CSSProperties}
    >
      <i className="hm-fill" aria-hidden="true" />
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
        <span className="hm-pct" aria-hidden="true">
          {on ? 'On' : 'Off'}
        </span>
      </button>
    </div>
  );
}

/**
 * A light is one tile: tap toggles, a sideways drag dims it with the fill under the finger,
 * and a long press opens the colour sheet. A visually hidden slider (and colour button) keep
 * the keyboard and screen-reader paths.
 */
function LightRow({ e, call, onColor }: RowProps & { onColor?: (e: HomeEntity) => void }) {
  const on = isOn(e);
  const pct = toPct(e.attrs.brightness);
  const remembered = useRef(pct ?? 60);
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    width: number;
    start: number;
    gesture: Gesture;
    long: ReturnType<typeof setTimeout> | undefined;
  } | null>(null);
  /** Swallows the click that follows a drag or a long press. */
  const swallow = useRef(false);
  useEffect(() => {
    if (pct) remembered.current = pct;
  }, [pct]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(press.current?.long);
    },
    [],
  );
  const canDim = dimmable(e);
  const caps = lightCaps(e);
  const colorful = !!onColor && (caps.color || caps.white);
  const locked = readOnly(e);
  const shown = drag ?? (on ? (pct ?? 100) : 0);

  const toggle = () =>
    call(e, on ? 'turn_off' : 'turn_on', undefined, {
      state: on ? 'off' : 'on',
      attrs: { brightness: on ? null : Math.round(remembered.current * 2.55) },
    });

  const send = (v: number) =>
    void call(
      e,
      'turn_on',
      { brightness_pct: v },
      { state: 'on', attrs: { brightness: Math.round(v * 2.55) } },
    ).finally(() => setDrag((d) => (d === v ? null : d)));

  const dim = (v: number, now = false) => {
    setDrag(v);
    clearTimeout(timer.current);
    if (now) send(v);
    else timer.current = setTimeout(() => send(v), DIM_DEBOUNCE_MS);
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (locked || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    swallow.current = false;
    const width = ev.currentTarget.getBoundingClientRect().width;
    press.current = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      width,
      start: dragStart(on, pct),
      gesture: 'pending',
      long: colorful
        ? setTimeout(() => {
            if (press.current?.gesture !== 'pending') return;
            swallow.current = true;
            press.current = null;
            onColor?.(e);
          }, LONG_PRESS_MS)
        : undefined,
    };
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== ev.pointerId) return;
    const dx = ev.clientX - p.x;
    if (p.gesture === 'pending') {
      p.gesture = classify(dx, ev.clientY - p.y);
      if (p.gesture === 'pending') return;
      clearTimeout(p.long);
      if (p.gesture === 'scroll' || !canDim) {
        // Up or down is the screen scrolling; let it have the finger.
        press.current = null;
        swallow.current = p.gesture === 'drag';
        return;
      }
      swallow.current = true;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    }
    dim(dragPct(p.start, dx, p.width));
  };

  const onPointerEnd = (ev: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== ev.pointerId) return;
    clearTimeout(p.long);
    press.current = null;
    if (p.gesture === 'drag' && ev.type === 'pointerup')
      dim(dragPct(p.start, ev.clientX - p.x, p.width), true);
  };

  const style = {
    '--v': `${shown}%`,
    '--lc': lightCss(e) ?? 'var(--accent)',
  } as React.CSSProperties;

  return (
    <div
      className={`hm-tile${on || drag ? ' on' : ' off'}${drag !== null ? ' dragging' : ''}${isUnavailable(e) ? ' na' : ''}${canDim ? ' dim' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(ev) => colorful && ev.preventDefault()}
    >
      <i className="hm-fill" aria-hidden="true" />
      <button
        className="hm-lr"
        role="switch"
        aria-checked={on}
        aria-label={e.name}
        disabled={locked}
        onClick={() => {
          if (swallow.current) {
            swallow.current = false;
            return;
          }
          void toggle();
        }}
      >
        <span>{e.name}</span>
        <span className="hm-pct tnum" aria-hidden="true">
          {colorful && <i className="hm-ldot" />}
          {on || drag ? (canDim ? `${shown}%` : 'On') : 'Off'}
        </span>
      </button>
      {canDim && (
        <input
          className="sr-only"
          type="range"
          min={1}
          max={100}
          value={drag ?? pct ?? remembered.current}
          disabled={locked || !on}
          aria-label={`${e.name} brightness`}
          onChange={(ev) => dim(Number(ev.target.value))}
        />
      )}
      {colorful && (
        <button
          type="button"
          className="sr-only"
          disabled={locked}
          aria-label={`${e.name} colour`}
          onClick={() => onColor?.(e)}
        />
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
