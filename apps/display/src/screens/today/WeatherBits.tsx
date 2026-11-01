/**
 * Weather pieces for presets other than Agenda, built on the weather feature's exports: a
 * one-line summary, and the next seven days for Weather focus (the card above has the hours).
 */
import { WeatherIcon, outlook, useWeather } from '../../features/weather';
import { dayNames } from './calendar';

export function WeatherLine({ now }: { now: Date }) {
  const w = useWeather().data;
  if (!w) return <div className="wline is-loading" aria-busy="true" />;
  const today = w.daily[0];
  return (
    <div className="wline" aria-label={`Weather, ${w.locationName}`}>
      <WeatherIcon className="wico" condition={w.current.condition} isDay={w.current.isDay} />
      <b className="tnum">{Math.round(w.current.temp)}°</b>
      <span className="sum">{w.current.summary}</span>
      {today && (
        <span className="hl tnum">
          H {Math.round(today.high)}° · L {Math.round(today.low)}°
        </span>
      )}
      <span className="out">{outlook(w, now)}</span>
    </div>
  );
}

export function WeekAhead() {
  const w = useWeather().data;
  if (!w) return <div className="card wahead is-loading" aria-busy="true" />;
  const todayIso = w.daily[0]?.date;
  return (
    <section className="card wahead" aria-label="The week ahead">
      <ul className="days" aria-label="Next seven days">
        {w.daily.slice(0, 7).map((d) => {
          const date = new Date(`${d.date}T12:00:00`);
          return (
            <li key={d.date}>
              <span className="dn">
                {d.date === todayIso ? 'Today' : dayNames[date.getDay()]!.slice(0, 3)}
              </span>
              <WeatherIcon condition={d.condition} />
              {d.precipChance >= 30 ? (
                <small className="tnum">{d.precipChance}%</small>
              ) : (
                <small className="none" />
              )}
              <b className="tnum">{Math.round(d.high)}°</b>
              <span className="lo tnum">{Math.round(d.low)}°</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
