/**
 * Dev-only demo of the WS4 pieces against the running server (`MOCK=1 pnpm dev`), until the
 * integration pass mounts them in Today and Ambient:
 *   http://localhost:5173/src/features/weather/demo.html          Daylight
 *   ...demo.html?mode=dusk                                       Dusk
 *   ...demo.html?ambient=1                                       straight into Ambient
 * Not part of the production build (Vite only builds index.html).
 */
import { DEFAULT_PANEL, type CalendarEvent } from '@mantel/shared';
import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../lib/api';
import { connectEvents } from '../../lib/events';
import { useFitScale } from '../../lib/fit';
import { PhotoSlideshow } from '../photos';
import {
  AmbientWeather,
  LeaveByChip,
  WeatherCard,
  formatHour,
  matchLeaveBy,
  useCommute,
  useWeather,
  type Weather,
} from '.';
import '../../styles/tokens.css';
import '../../styles/base.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.mode = params.get('mode') === 'dusk' ? 'dusk' : 'daylight';

const colors: Record<string, string> = {
  jay: 'var(--p-jay)',
  sam: 'var(--p-sam)',
  ava: 'var(--p-ava)',
  leo: 'var(--p-leo)',
};

function withAlert(w: Weather): Weather {
  const ends = new Date();
  ends.setHours(18, 0, 0, 0);
  return {
    ...w,
    alerts: [
      {
        id: 'demo-alert',
        event: 'Wind Advisory',
        severity: 'moderate',
        headline: 'Wind Advisory until 6 PM',
        description:
          'Southwest winds 20 to 30 mph with gusts up to 45 mph. Secure outdoor objects.',
        starts: new Date().toISOString(),
        ends: ends.toISOString(),
      },
    ],
  };
}

function Demo() {
  const scale = useFitScale(DEFAULT_PANEL.width, DEFAULT_PANEL.height);
  const weather = useWeather();
  const commute = useCommute();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [ambient, setAmbient] = useState(params.has('ambient'));
  const [tint, setTint] = useState<string | null>(null);
  useEffect(connectEvents, []);
  useEffect(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 864e5);
    api
      .call('calendar', { query: { from: from.toISOString(), to: to.toISOString() } })
      .then((r) => setEvents(r.events.filter((e) => !e.allDay)))
      .catch(() => setEvents([]));
  }, []);

  const trips = commute.data ?? [];
  const paired = matchLeaveBy(events, trips);
  const now = new Date();
  const next = events.find((e) => new Date(e.start) > now) ?? events[0];

  return (
    <div style={stage}>
      <div style={{ ...panel, transform: `scale(${scale})` }}>
        <div style={grid}>
          <div style={col}>
            <div className="eyebrow">Weather card · live from /api/weather</div>
            <WeatherCard />
            <div className="eyebrow">With an active alert (tap it)</div>
            {weather.data && <WeatherCard weather={withAlert(weather.data)} />}
          </div>
          <div style={col}>
            <div className="card" style={{ padding: '22px 24px', display: 'grid', gap: 14 }}>
              <div className="eyebrow">Leave-by chips next to the event they are for</div>
              {events.slice(0, 5).map((e) => {
                const trip = paired.get(e.id);
                return (
                  <div key={e.id} style={eventRow}>
                    <b className="tnum" style={{ width: 76 }}>
                      {formatHour(e.start)}
                    </b>
                    <i style={{ ...bar, background: e.color }} />
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
                      <span style={{ fontWeight: 600 }}>{e.title}</span>
                      {trip && <LeaveByChip trip={trip} color={colors[trip.personIds[0] ?? '']} />}
                    </div>
                  </div>
                );
              })}
              <div className="eyebrow" style={{ marginTop: 8 }}>
                Every trip, with names and states
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {trips.map((t) => (
                  <LeaveByChip key={t.destinationId} trip={t} showName now={new Date(0)} />
                ))}
                {trips[0] && (
                  <LeaveByChip
                    trip={trips[0]}
                    showName
                    now={new Date(new Date(trips[0].leaveBy).getTime() - 5 * 60_000)}
                  />
                )}
                {trips[0] && <LeaveByChip trip={trips[0]} showName now={new Date(8.64e15)} />}
              </div>
            </div>
            <button className="card" style={ambientButton} onClick={() => setAmbient(true)}>
              Preview Ambient with the server's photos
            </button>
          </div>
        </div>

        {ambient && (
          <div style={ambientLayer} onClick={() => setAmbient(false)}>
            <PhotoSlideshow onPhoto={(p) => setTint(p?.dominant ?? null)} />
            <div style={veil} />
            <div style={clock}>
              <b style={{ font: '300 124px/0.9 var(--display)', letterSpacing: '-0.04em' }}>
                {`${((now.getHours() + 11) % 12) + 1}:${String(now.getMinutes()).padStart(2, '0')}`}
              </b>
              <span style={{ font: 'italic 400 24px/1.2 var(--display)', marginTop: 8 }}>
                {now.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
              {tint && (
                <span style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                  <i style={{ ...swatch, background: tint }} /> dominant {tint}
                </span>
              )}
            </div>
            <div style={side}>
              <AmbientWeather />
              {next && (
                <div style={{ fontSize: 15, opacity: 0.85 }}>
                  Next · {formatHour(next.start)}
                  <b style={{ display: 'block', fontSize: 19, fontWeight: 600, opacity: 1 }}>
                    {next.title}
                  </b>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const stage: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--bg)',
};
const panel: CSSProperties = {
  position: 'relative',
  width: DEFAULT_PANEL.width,
  height: DEFAULT_PANEL.height,
  background: 'var(--bg)',
  color: 'var(--ink)',
  overflow: 'hidden',
  flex: 'none',
};
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '392px 1fr',
  gap: 28,
  padding: '34px 36px',
  height: '100%',
};
const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 };
const eventRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '76px 4px 1fr',
  gap: 14,
  alignItems: 'start',
  fontSize: 15,
};
const bar: CSSProperties = { width: 4, alignSelf: 'stretch', borderRadius: 2 };
const ambientButton: CSSProperties = {
  height: 'var(--tap)',
  fontWeight: 700,
  color: 'var(--accent)',
};
const ambientLayer: CSSProperties = { position: 'absolute', inset: 0, zIndex: 9, color: '#fff' };
const veil: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)',
};
const clock: CSSProperties = {
  position: 'absolute',
  left: 48,
  bottom: 44,
  display: 'flex',
  flexDirection: 'column',
  textShadow: '0 2px 20px rgba(0,0,0,.4)',
};
const side: CSSProperties = {
  position: 'absolute',
  right: 48,
  bottom: 52,
  textAlign: 'right',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  textShadow: '0 2px 20px rgba(0,0,0,.4)',
};
const swatch: CSSProperties = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 3,
  verticalAlign: -1,
  border: '1px solid rgba(255,255,255,.6)',
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
