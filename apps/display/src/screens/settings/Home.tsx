import type { GeocodeCandidate, Settings } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { errorText, geocode } from './client';
import { Combobox, Field, GetItHere, Result, Section, Seg, TextInput } from './controls';

/** "42.6003, -83.3309" (or with a space or tab between) as a pair of numbers, else null. */
export function parseLatLng(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

const timeZones: string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** "America/Detroit" as "America / Detroit (UTC-4)". */
export function formatZone(tz: string, now = new Date()): string {
  let offset = '';
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName');
    if (part) offset = ` (${part.value.replace('GMT', 'UTC')})`;
  } catch {
    // An unknown zone still shows as typed.
  }
  return `${tz.replace(/_/g, ' ').replace(/\//g, ' / ')}${offset}`;
}

const fmt = (n: number) => (Math.round(n * 10_000) / 10_000).toString();

/**
 * One field for where the house is: an address, a town, or "47.6062, -122.3321" pasted straight
 * from Google Maps. A place search fills the name, coordinates and timezone together.
 */
export function LocationField({
  value,
  timezone,
  onChange,
}: {
  value: Settings['location'];
  timezone: string;
  onChange: (location: Settings['location'], timezone?: string) => void;
}) {
  const [query, setQuery] = useState(value.query ?? '');
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const applyPair = (pair: [number, number], text: string) => {
    onChange({ ...value, latitude: pair[0], longitude: pair[1], query: text.trim() });
    setCandidates(null);
    setResult({ ok: true, message: `Using ${fmt(pair[0])}, ${fmt(pair[1])}.` });
  };

  const search = async () => {
    const text = query.trim();
    if (!text) return;
    const pair = parseLatLng(text);
    if (pair) return applyPair(pair, text);
    setBusy(true);
    setResult(null);
    try {
      const found = await geocode(text);
      if (found.length === 0)
        setResult({
          ok: false,
          message: `Nothing matched “${text}”. Check the spelling, try just the town, or paste coordinates from Google Maps.`,
        });
      else if (found.length === 1) pick(found[0]!, text);
      else setCandidates(found);
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const pick = (c: GeocodeCandidate, text = query) => {
    onChange(
      { ...value, name: c.name, latitude: c.latitude, longitude: c.longitude, query: text.trim() },
      c.timezone,
    );
    setCandidates(null);
    setResult({
      ok: true,
      message: `${describe(c)} · ${fmt(c.latitude)}, ${fmt(c.longitude)}${c.timezone ? ` · ${c.timezone}` : ''}`,
    });
  };

  return (
    <>
      <Field
        label="Where the house is"
        stack
        hint={
          <>
            Type a town or address, or paste the coordinates Google Maps gives you when you
            right-click the house.{' '}
            <GetItHere label="Open Google Maps" url="https://www.google.com/maps" />
          </>
        }
      >
        <span className="set-pair grow">
          <TextInput
            label="Location"
            className="grow"
            value={query}
            placeholder="Seattle, WA  or  47.6062, -122.3321"
            onChange={(v) => {
              setQuery(v);
              setResult(null);
            }}
            onPasteText={(text) => {
              const pair = parseLatLng(text);
              if (!pair) return false;
              setQuery(text.trim());
              applyPair(pair, text);
              return true;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
          <button
            type="button"
            className="set-btn"
            disabled={busy || !query.trim()}
            onClick={() => void search()}
          >
            {busy ? 'Looking…' : 'Find'}
          </button>
        </span>
      </Field>
      {candidates && (
        <ul className="set-candidates" aria-label="Places found">
          {candidates.map((c, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(c)}>
                <span>{describe(c)}</span>
                <span className="set-hint tnum">
                  {fmt(c.latitude)}, {fmt(c.longitude)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Result result={result} />
      <Field label="Place name" hint="Shown on the weather card.">
        <TextInput
          label="Place name"
          value={value.name}
          onChange={(name) => onChange({ ...value, name })}
        />
      </Field>
      <div className="set-field">
        <span className="set-label">
          Coordinates
          <span className="set-hint">Filled from the search; edit only if you need to.</span>
        </span>
        <span className="set-pair">
          <PairInput
            latitude={value.latitude}
            longitude={value.longitude}
            onChange={(latitude, longitude) => onChange({ ...value, latitude, longitude })}
          />
        </span>
      </div>
      <TimezoneField value={timezone} onChange={(tz) => onChange(value, tz)} />
    </>
  );
}

const describe = (c: GeocodeCandidate) => c.name;

/** "lat, lng" as one editable field: the text is the user's until it parses as a pair. */
function PairInput({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}) {
  const shown = `${fmt(latitude)}, ${fmt(longitude)}`;
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  return (
    <input
      className="set-input tnum"
      aria-label="Latitude, longitude"
      inputMode="decimal"
      value={editing ? text : shown}
      onFocus={() => {
        setText(shown);
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value);
        const pair = parseLatLng(e.target.value);
        if (pair) onChange(pair[0], pair[1]);
      }}
    />
  );
}

/** Type-to-search timezone with a one-tap "use this device's" button. */
export function TimezoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const mine = deviceTimeZone();
  return (
    <Field
      label="Timezone"
      hint={
        <>
          Filled from the place search. The screen schedule runs on this clock.
          {mine && mine !== value && (
            <>
              {' '}
              <button type="button" className="set-linkbtn" onClick={() => onChange(mine)}>
                Use this device’s: {formatZone(mine)}
              </button>
            </>
          )}
        </>
      }
    >
      <Combobox
        label="Timezone"
        value={value}
        options={timeZones.length ? timeZones : [value]}
        onChange={onChange}
        placeholder="Type a city, like Detroit"
        format={(tz) => formatZone(tz)}
      />
    </Field>
  );
}

export function HomeSection({
  draft,
  set,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  // A timezone that arrives with a place search lands together with the location.
  const [pendingTz, setPendingTz] = useState<string | null>(null);
  useEffect(() => {
    if (pendingTz) {
      set('timezone', pendingTz);
      setPendingTz(null);
    }
  }, [pendingTz, set]);
  return (
    <Section
      id="home"
      title="Your home"
      hint="Where the house is, for weather, sunrise and the clock, and how the wall looks."
    >
      <LocationField
        value={draft.location}
        timezone={draft.timezone}
        onChange={(location, tz) => {
          set('location', location);
          if (tz) setPendingTz(tz);
        }}
      />
      <Field label="Units">
        <Seg
          label="Units"
          value={draft.units}
          options={[
            ['imperial', '°F, miles'],
            ['metric', '°C, km'],
          ]}
          onChange={(v) => set('units', v)}
        />
      </Field>
      <Field
        label="Look"
        hint="Auto uses Dusk from evening until morning. Skins are under Appearance."
      >
        <Seg
          label="Look"
          value={draft.theme}
          options={
            [
              ['auto', 'Auto'],
              ['daylight', 'Daylight'],
              ['dusk', 'Dusk'],
            ] as Array<[Settings['theme'], string]>
          }
          onChange={(v) => set('theme', v)}
        />
      </Field>
    </Section>
  );
}
