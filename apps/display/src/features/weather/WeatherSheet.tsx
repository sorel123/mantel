import type { WeatherPlace, WeatherSavedPlace } from '@mantel/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HourlyStrip } from './WeatherCard';
import {
  MOON_GLYPH,
  compass,
  dayLabel,
  distanceUnit,
  formatAmount,
  formatHour,
  formatWhen,
  hourDayLabel,
  pollenWord,
  speedUnit,
} from './format';
import { Icon, WeatherIcon } from './icons';
import {
  fetchPlace,
  searchPlaces,
  toggleSavedPlace,
  useQuip,
  useWeatherPrefs,
  type Weather,
} from './store';
import './weather.css';

type Tab = 'hourly' | 'daily' | 'details' | 'alerts';
const TABS: Array<[Tab, string]> = [
  ['hourly', 'Hourly'],
  ['daily', '10-day'],
  ['details', 'Details'],
  ['alerts', 'Alerts'],
];

interface Shown {
  kind: 'home' | 'place';
  name: string;
  latitude?: number;
  longitude?: number;
}

/**
 * The weather sheet: tap the card and this slides in. A row of places (home, saved places, a
 * search box), the current conditions, then tabs for the next 48 hours as a chart, the ten-day
 * outlook, every measurement, and active alerts.
 */
export function WeatherSheet({
  home,
  now = new Date(),
  onClose,
}: {
  home: Weather;
  now?: Date;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('hourly');
  const [shown, setShown] = useState<Shown>({ kind: 'home', name: home.locationName });
  const [place, setPlace] = useState<{ key: string; weather: Weather | null; error?: string }>({
    key: 'home',
    weather: null,
  });
  const prefs = useWeatherPrefs().data;
  const quip = useQuip().data;

  const key =
    shown.kind === 'home' ? 'home' : `${shown.latitude!.toFixed(4)},${shown.longitude!.toFixed(4)}`;
  useEffect(() => {
    if (shown.kind === 'home') return;
    let gone = false;
    setPlace({ key, weather: null });
    fetchPlace({ latitude: shown.latitude!, longitude: shown.longitude!, name: shown.name }).then(
      (weather) => !gone && setPlace({ key, weather }),
      (err: unknown) =>
        !gone &&
        setPlace({
          key,
          weather: null,
          error:
            `Could not get the weather for ${shown.name}. ${err instanceof Error ? err.message : ''}`.trim(),
        }),
    );
    return () => {
      gone = true;
    };
  }, [key, shown]);

  const w = shown.kind === 'home' ? home : place.key === key ? place.weather : null;
  const saved = prefs?.savedPlaces ?? [];
  const isSaved =
    shown.kind === 'place' &&
    saved.some(
      (p) =>
        Math.abs(p.latitude - shown.latitude!) < 1e-4 &&
        Math.abs(p.longitude - shown.longitude!) < 1e-4,
    );

  return (
    <div className="wx-sheet">
      <div className="sheet-head">
        <div className="wx-sheet-title">
          <div className="eyebrow">Weather</div>
          <h2 className="h1">{shown.name}</h2>
        </div>
        <button className="x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <Places
        home={home.locationName}
        saved={saved}
        shown={shown}
        onPick={(s) => setShown(s)}
        isSaved={isSaved}
        onToggleSave={
          shown.kind === 'place'
            ? () =>
                toggleSavedPlace({
                  name: shown.name,
                  latitude: shown.latitude!,
                  longitude: shown.longitude!,
                }).catch(() => undefined)
            : undefined
        }
      />

      {w ? (
        <>
          <div className="wx-sheet-now">
            <WeatherIcon
              className="ico wico"
              condition={w.current.condition}
              isDay={w.current.isDay}
            />
            <div className="temp tnum">{Math.round(w.current.temp)}°</div>
            <div className="cond">
              <b>{w.current.summary}</b>
              <span className="tnum">
                H {Math.round(w.daily[0]?.high ?? w.current.temp)}° · L{' '}
                {Math.round(w.daily[0]?.low ?? w.current.temp)}°
              </span>
              <span>Feels like {Math.round(w.current.feelsLike)}°</span>
            </div>
          </div>
          {shown.kind === 'home' && quip && <p className="wx-quip">{quip.text}</p>}

          <div className="seg wx-tabs" role="tablist" aria-label="Forecast views">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                className="btn"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
                {id === 'alerts' && w.alerts.length > 0 && (
                  <span className="wx-badge tnum">{w.alerts.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="sheet-body wx-body" role="tabpanel">
            {tab === 'hourly' && <HourlyTab weather={w} now={now} />}
            {tab === 'daily' && <DailyTab weather={w} now={now} />}
            {tab === 'details' && <DetailsTab weather={w} now={now} />}
            {tab === 'alerts' && <AlertsTab weather={w} now={now} />}
          </div>
        </>
      ) : (
        <div className="wx-body empty" aria-busy={!place.error}>
          {place.key === key && place.error
            ? place.error
            : `Getting the weather for ${shown.name}…`}
        </div>
      )}
    </div>
  );
}

/* ---------- places ---------- */

function Places({
  home,
  saved,
  shown,
  onPick,
  isSaved,
  onToggleSave,
}: {
  home: string;
  saved: WeatherSavedPlace[];
  shown: Shown;
  onPick: (s: Shown) => void;
  isSaved: boolean;
  onToggleSave?: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WeatherPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const abort = useRef<AbortController>(undefined);

  // Search as you type, a beat after the last key.
  useEffect(() => {
    abort.current?.abort();
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    setSearching(true);
    const t = setTimeout(() => {
      searchPlaces(text, ctl.signal).then(
        (places) => {
          if (ctl.signal.aborted) return;
          setResults(places);
          setSearching(false);
        },
        () => {
          if (ctl.signal.aborted) return;
          setResults([]);
          setSearching(false);
        },
      );
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const pick = (p: { name: string; latitude: number; longitude: number }) => {
    onPick({ kind: 'place', name: p.name, latitude: p.latitude, longitude: p.longitude });
    setQ('');
    setResults(null);
  };
  const isShown = (p: { latitude: number; longitude: number }) =>
    shown.kind === 'place' &&
    Math.abs(p.latitude - shown.latitude!) < 1e-4 &&
    Math.abs(p.longitude - shown.longitude!) < 1e-4;

  return (
    <div className="wx-places">
      <div className="wx-chips scroll-x" role="group" aria-label="Places">
        <button
          className={`chip${shown.kind === 'home' ? '' : ' neutral'}`}
          aria-pressed={shown.kind === 'home'}
          onClick={() => onPick({ kind: 'home', name: home })}
        >
          {home}
        </button>
        {saved.map((p) => (
          <button
            key={`${p.latitude},${p.longitude}`}
            className={`chip${isShown(p) ? '' : ' neutral'}`}
            aria-pressed={isShown(p)}
            onClick={() => pick(p)}
          >
            {p.name}
          </button>
        ))}
        {shown.kind === 'place' && !saved.some(isShown) && (
          <span className="chip" aria-current="true">
            {shown.name}
          </span>
        )}
        {onToggleSave && (
          <button
            className="btn sm icon quiet wx-save"
            aria-label={isSaved ? `Forget ${shown.name}` : `Save ${shown.name}`}
            aria-pressed={isSaved}
            onClick={onToggleSave}
          >
            <svg viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'}>
              <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
            </svg>
          </button>
        )}
      </div>
      <div className="wx-search">
        <input
          className="input"
          type="search"
          placeholder="Search a city, or paste coordinates"
          aria-label="Search for a place"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) pick(results[0]);
            if (e.key === 'Escape') setQ('');
          }}
        />
        {results !== null && (
          <ul className="wx-results" role="listbox" aria-label="Places found">
            {results.length === 0 && !searching && (
              <li className="empty">No place called “{q.trim()}”. Try the nearest big town.</li>
            )}
            {results.map((p) => (
              <li key={p.id}>
                <button role="option" aria-selected={false} onClick={() => pick(p)}>
                  <b>{p.name}</b>
                  <span>{[p.region, p.country].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- hourly: a chart and the strip ---------- */

export function HourlyTab({ weather: w, now }: { weather: Weather; now: Date }) {
  const hours = w.hourly.slice(0, 48);
  return (
    <>
      <TempChart weather={w} now={now} />
      <HourlyStrip weather={w} now={now} size="sheet" />
      <ul className="wx-hours">
        {hours
          .filter((_, i) => i % 3 === 0)
          .map((h, i) => (
            <li key={h.time}>
              <span className="tnum">
                {i === 0 ? 'Next' : formatHour(h.time)}
                <small>
                  {hourDayLabel(h.time, now) === 'Today' ? '' : hourDayLabel(h.time, now)}
                </small>
              </span>
              <WeatherIcon condition={h.condition} isDay={h.isDay} />
              <b className="tnum">{Math.round(h.temp)}°</b>
              <span className="tnum rain">{h.precipChance >= 10 ? `${h.precipChance}%` : ''}</span>
              <span className="tnum">
                {h.windSpeed !== undefined
                  ? `${Math.round(h.windSpeed)} ${speedUnit(w.units)}`
                  : ''}
                {h.windDirection !== undefined ? ` ${compass(h.windDirection)}` : ''}
              </span>
            </li>
          ))}
      </ul>
    </>
  );
}

/** Temperature line over rain bars, 48 hours wide, drawn as SVG so it scales with the sheet. */
export function TempChart({ weather: w, now }: { weather: Weather; now: Date }) {
  const hours = w.hourly.slice(0, 48);
  const W = 496;
  const H = 180;
  const padX = 18;
  const top = 26;
  const bottom = 54;
  const geometry = useMemo(() => {
    const temps = hours.map((h) => h.temp);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(8, max - min);
    const x = (i: number) => padX + (i / Math.max(1, hours.length - 1)) * (W - padX * 2);
    const y = (t: number) => top + (1 - (t - min) / span) * (H - top - bottom);
    const path = hours
      .map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`)
      .join(' ');
    const area = `${path} L${x(hours.length - 1).toFixed(1)},${H - bottom} L${x(0).toFixed(1)},${H - bottom} Z`;
    const hi = temps.indexOf(max);
    const lo = temps.indexOf(min);
    return { x, y, path, area, hi, lo, min, max };
  }, [hours]);
  if (hours.length < 2) return null;
  const { x, y, path, area, hi, lo } = geometry;
  const barW = (W - padX * 2) / hours.length;
  const dayStarts = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i > 0 && new Date(h.time).getHours() === 0)
    .map(({ h, i }) => ({ i, label: hourDayLabel(h.time, now) }));

  return (
    <svg
      className="wx-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Temperature and rain over the next ${hours.length} hours`}
    >
      {hours.map((h, i) =>
        h.precipChance >= 10 ? (
          <rect
            key={h.time}
            className="bar"
            x={x(i) - barW / 2 + 1}
            width={Math.max(1, barW - 2)}
            y={H - bottom - (h.precipChance / 100) * 56}
            height={(h.precipChance / 100) * 56}
            rx={1.5}
          />
        ) : null,
      )}
      {dayStarts.map(({ i, label }) => (
        <g key={i} className="day">
          <line x1={x(i)} x2={x(i)} y1={10} y2={H - bottom} />
          <text x={x(i) + 6} y={16}>
            {label}
          </text>
        </g>
      ))}
      <path className="area" d={area} />
      <path className="line" d={path} />
      <g className="mark">
        <circle cx={x(hi)} cy={y(hours[hi]!.temp)} r={3.5} />
        <text x={x(hi)} y={y(hours[hi]!.temp) - 9} textAnchor="middle">
          {Math.round(hours[hi]!.temp)}°
        </text>
        <circle cx={x(lo)} cy={y(hours[lo]!.temp)} r={3.5} />
        <text x={x(lo)} y={y(hours[lo]!.temp) + 16} textAnchor="middle">
          {Math.round(hours[lo]!.temp)}°
        </text>
      </g>
      <g className="axis">
        {hours.map((h, i) =>
          i % 6 === 0 ? (
            <text key={h.time} x={x(i)} y={H - 22} textAnchor="middle">
              {i === 0 ? 'Next' : formatHour(h.time).replace(' ', '')}
            </text>
          ) : null,
        )}
        <text x={W - padX} y={H - 6} textAnchor="end" className="legend">
          bars: chance of rain
        </text>
      </g>
    </svg>
  );
}

/* ---------- ten days ---------- */

export function DailyTab({ weather: w, now }: { weather: Weather; now: Date }) {
  const days = w.daily.slice(0, 10);
  const min = Math.min(...days.map((d) => d.low));
  const max = Math.max(...days.map((d) => d.high));
  const span = Math.max(1, max - min);
  return (
    <ul className="wx-days" aria-label="Ten-day forecast">
      {days.map((d) => (
        <li key={d.date}>
          <span className="d">
            <b>{dayLabel(d.date, now)}</b>
            <small>{d.summary ?? ''}</small>
          </span>
          <WeatherIcon condition={d.condition} isDay />
          <span className="rain tnum">{d.precipChance >= 10 ? `${d.precipChance}%` : ''}</span>
          <span className="lo tnum">{Math.round(d.low)}°</span>
          <span className="range" aria-hidden="true">
            <i
              style={
                {
                  '--l': `${((d.low - min) / span) * 100}%`,
                  '--r': `${(1 - (d.high - min) / span) * 100}%`,
                } as CSSProperties
              }
            />
          </span>
          <span className="hi tnum">{Math.round(d.high)}°</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- details ---------- */

export function DetailsTab({ weather: w, now }: { weather: Weather; now: Date }) {
  const h = w.hourly[0];
  const today = w.daily[0];
  const u = w.units;
  const num = (v: number | undefined, suffix = '') => (v === undefined ? '—' : `${v}${suffix}`);
  const rows: Array<[string, string, string?]> = [
    ['Feels like', `${Math.round(w.current.feelsLike)}°`],
    ['Humidity', `${w.current.humidity}%`],
    ['Dew point', h?.dewPoint === undefined ? '—' : `${Math.round(h.dewPoint)}°`],
    [
      'Wind',
      `${Math.round(w.current.windSpeed)} ${speedUnit(u)}${h?.windDirection !== undefined ? ` ${compass(h.windDirection)}` : ''}`,
      h?.windGust !== undefined ? `gusts ${Math.round(h.windGust)}` : undefined,
    ],
    ['Pressure', num(h?.pressure, ' hPa')],
    ['Visibility', num(h?.visibility, ` ${distanceUnit(u)}`)],
    ['UV', `${w.uv.index}`, w.uv.category],
    [
      'Rain today',
      formatAmount(today?.precipSum, u) ?? 'None expected',
      `${today?.precipChance ?? 0}% chance`,
    ],
    ['Sunrise', formatHour(w.sunrise)],
    ['Sunset', formatHour(w.sunset)],
    ['Daylight', today?.daylightHours === undefined ? '—' : `${today.daylightHours.toFixed(1)} h`],
    [
      'Moon',
      w.moon ? `${MOON_GLYPH[w.moon.phase]} ${w.moon.label}` : '—',
      w.moon ? `${w.moon.illumination}% lit` : undefined,
    ],
    ['Air quality', w.airQuality ? `${w.airQuality.aqi}` : 'No data', w.airQuality?.category],
    [
      'Pollen',
      w.pollen
        ? `Tree ${pollenWord(w.pollen.tree).toLowerCase()}, grass ${pollenWord(w.pollen.grass).toLowerCase()}, weed ${pollenWord(w.pollen.weed).toLowerCase()}`
        : 'No data',
    ],
    ['Updated', formatWhen(w.updatedAt, now)],
  ];
  return (
    <dl className="wx-details">
      {rows.map(([label, value, note]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <b>{value}</b>
            {note && <span>{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- alerts ---------- */

export function AlertsTab({ weather: w, now }: { weather: Weather; now: Date }) {
  if (!w.alerts.length)
    return <div className="empty wx-noalerts">No alerts for {w.locationName}. Carry on.</div>;
  return (
    <ul className="wx-alerts">
      {w.alerts.map((a) => (
        <li key={a.id} data-severity={a.severity}>
          <div className="row">
            <Icon name="alert" className="wico" />
            <div>
              <b>{a.event}</b>
              <span>
                {a.severity !== 'unknown' &&
                  `${a.severity[0]!.toUpperCase()}${a.severity.slice(1)} · `}
                {a.ends ? `until ${formatWhen(a.ends, now)}` : `from ${formatWhen(a.starts, now)}`}
              </span>
            </div>
          </div>
          <p>{a.description || a.headline}</p>
        </li>
      ))}
    </ul>
  );
}
