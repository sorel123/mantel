import { useEffect, useRef, useState, type UIEvent } from 'react';
import { useOverlay } from '../../app/overlay';
import { formatHour, formatWhen, hourDayLabel, nextSun, outlook, worstPollen } from './format';
import { Icon, WeatherIcon } from './icons';
import { useQuip, useWeather, type Weather } from './store';
import { WeatherSheet } from './WeatherSheet';
import './weather.css';

/**
 * The Today screen's weather card: now, high and low with a one-line outlook (or the day's quip
 * when a personality is on), the next 48 hours in a scroller, and an extras row (sun, UV, air
 * quality, pollen). Active alerts sit on top. Tapping the card opens the weather sheet.
 * Pass `weather` to render a fixed snapshot; otherwise it reads the shared weather store.
 * `interactive={false}` renders without the sheet (demos and tests outside the shell).
 */
export function WeatherCard({
  weather,
  now,
  interactive = true,
}: {
  weather?: Weather;
  now?: Date;
  interactive?: boolean;
}) {
  const live = useWeather();
  const quip = useQuip().data;
  const w = weather ?? live.data;
  if (!w) return <div className="card weather is-loading" aria-busy="true" />;
  const today = w.daily[0];
  const at = now ?? new Date();

  return (
    <section className="card weather" aria-label={`Weather, ${w.locationName}`}>
      {w.alerts.length > 0 && <Alerts alerts={w.alerts} />}
      <div className="now">
        <WeatherIcon className="ico wico" condition={w.current.condition} isDay={w.current.isDay} />
        <div className="temp tnum">{Math.round(w.current.temp)}°</div>
        <div className="cond">
          <b>{w.current.summary}</b>
          {today && (
            <span className="tnum">
              H {Math.round(today.high)}° · L {Math.round(today.low)}°
            </span>
          )}
          {!quip && <span>{outlook(w, at)}</span>}
        </div>
        {interactive && <OpenSheet weather={w} now={at} />}
      </div>
      {quip && <p className="wx-quip">{quip.text}</p>}
      <HourlyStrip weather={w} now={at} />
      <WeatherExtras weather={w} now={at} />
    </section>
  );
}

/** The round "more" button; the only piece of the card that needs the shell's overlay. */
function OpenSheet({ weather, now }: { weather: Weather; now: Date }) {
  const { openSheet } = useOverlay();
  return (
    <button
      className="wx-more"
      aria-label="Open the forecast"
      onClick={() =>
        openSheet((close) => <WeatherSheet home={weather} now={now} onClose={close} />, {
          wide: true,
          label: `Weather, ${weather.locationName}`,
        })
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

/** Milliseconds without a touch before the hourly strip slides back to now. */
export const STRIP_SNAP_BACK_MS = 90_000;

/**
 * The next hours in a horizontal scroller: temperature, icon, a rain bar for wet hours, and a
 * day label where tomorrow starts. Scroll ahead to see later; it slides back to now after a
 * while untouched, so the wall always shows the next few hours.
 */
export function HourlyStrip({
  weather,
  hours = 48,
  now = new Date(),
  size = 'card',
}: {
  weather: Weather;
  hours?: number;
  now?: Date;
  size?: 'card' | 'sheet';
}) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    clearTimeout(timer.current);
    if (el.scrollLeft < 2) return;
    timer.current = setTimeout(() => {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    }, STRIP_SNAP_BACK_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const list = weather.hourly.slice(0, hours);
  let lastDay = '';
  return (
    <div
      className={`hourly scroll-x is-${size}`}
      ref={box}
      onScroll={onScroll}
      role="list"
      aria-label="Hourly forecast"
    >
      {list.map((h, i) => {
        const day = hourDayLabel(h.time, now);
        const newDay = i > 0 && day !== lastDay;
        lastDay = day;
        const wet = h.precipChance >= 20;
        return (
          <div key={h.time} role="listitem" className={newDay ? 'new-day' : undefined}>
            <span className={newDay ? 'day' : undefined}>
              {i === 0 ? 'Next' : newDay ? day : formatHour(h.time)}
            </span>
            <WeatherIcon condition={h.condition} isDay={h.isDay} />
            <b className="tnum">{Math.round(h.temp)}°</b>
            <i
              className="rain"
              style={{ '--p': wet ? h.precipChance / 100 : 0 } as React.CSSProperties}
              aria-hidden="true"
            />
            <small className="tnum">{wet ? `${h.precipChance}%` : ''}</small>
          </div>
        );
      })}
    </div>
  );
}

/** Sun, UV, air quality and pollen, each shown only when the server has it. */
export function WeatherExtras({ weather: w, now = new Date() }: { weather: Weather; now?: Date }) {
  const sun = nextSun(w, now);
  const pollen = worstPollen(w.pollen);
  const aqi = w.airQuality;
  return (
    <ul className="wx-extras" aria-label="Conditions">
      <li>
        <span>{sun.kind === 'sunrise' ? 'Sunrise' : 'Sunset'}</span>
        <b className="tnum">{formatHour(sun.time)}</b>
      </li>
      <li data-level={w.uv.index >= 6 ? 'high' : undefined}>
        <span>UV</span>
        <b className="tnum">{w.uv.index}</b>
        <span>{w.uv.category}</span>
      </li>
      {aqi && (
        <li data-level={aqi.aqi > 100 ? 'high' : undefined}>
          <span>Air</span>
          <b className="tnum">{aqi.aqi}</b>
          <span>{aqi.category.replace('Unhealthy for sensitive groups', 'Sensitive')}</span>
        </li>
      )}
      {pollen && (
        <li data-level={pollen.rank >= 3 ? 'high' : undefined}>
          <span>Pollen</span>
          <b>{pollen.rank === 0 ? 'None' : pollen.level}</b>
          {pollen.rank > 0 && <span>{pollen.label.toLowerCase()}</span>}
        </li>
      )}
    </ul>
  );
}

function Alerts({ alerts }: { alerts: Weather['alerts'] }) {
  const [open, setOpen] = useState(false);
  const first = alerts[0]!;
  return (
    <button
      className="wx-alert"
      data-severity={first.severity}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
    >
      <Icon name="alert" />
      <span className="wx-alert-text">
        <b>
          {first.event}
          {alerts.length > 1 && <em> and {alerts.length - 1} more</em>}
        </b>
        {first.ends && <span>Until {formatWhen(first.ends)}</span>}
        {open && <span className="wx-alert-body">{first.description || first.headline}</span>}
      </span>
    </button>
  );
}
