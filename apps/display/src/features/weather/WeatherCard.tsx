import { useState } from 'react';
import { formatHour, formatWhen, nextSun, outlook, worstPollen } from './format';
import { Icon, WeatherIcon } from './icons';
import { useWeather, type Weather } from './store';
import './weather.css';

/**
 * The Today screen's weather card: now, high and low with a one-line outlook, the next six
 * hours, and an extras row (sun, UV, air quality, pollen). Active alerts sit on top.
 * Pass `weather` to render a fixed snapshot; otherwise it reads the shared weather store.
 */
export function WeatherCard({ weather, now }: { weather?: Weather; now?: Date }) {
  const live = useWeather();
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
          <span>{outlook(w, at)}</span>
        </div>
      </div>
      <HourlyStrip weather={w} />
      <WeatherExtras weather={w} now={at} />
    </section>
  );
}

export function HourlyStrip({ weather, hours = 6 }: { weather: Weather; hours?: number }) {
  return (
    <div className="hourly" style={{ gridTemplateColumns: `repeat(${hours}, 1fr)` }}>
      {weather.hourly.slice(0, hours).map((h, i) => (
        <div key={h.time}>
          <span>{i === 0 ? 'Next' : formatHour(h.time)}</span>
          <WeatherIcon condition={h.condition} isDay={h.isDay} />
          <b className="tnum">{Math.round(h.temp)}°</b>
          {h.precipChance >= 30 && <small className="tnum">{h.precipChance}%</small>}
        </div>
      ))}
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
