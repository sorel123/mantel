/**
 * Sky (v4 G): sunrise, sunset and day length for the home location, the moon's phase, and the
 * next thing worth looking up for (a named full moon, a solstice or equinox, a meteor shower).
 * Computed here from the location in Settings, no service and no key: the sun with the standard
 * sunrise equation (as NOAA and suncalc), the moon from its mean cycle, seasons from Meeus.
 */
import { addDays, startOfDay, type PluginBlocksInput, type TestResult } from '@mantel/shared';
import type { ProviderContext } from '../../providers/types.js';
import { clock, dayDiff, dayWord, inDays, type PackDeps } from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const toJulian = (d: Date) => d.getTime() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const OBLIQUITY = RAD * 23.4397;

/** Sunrise and sunset on the local day of `date`; null for polar day or night. */
export function sunTimes(date: Date, lat: number, lon: number): { rise: Date; set: Date } | null {
  const noon = startOfDay(date);
  noon.setHours(12);
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toJulian(noon) - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const transit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW =
    (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW);
  const set =
    J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJulian(transit - (set - transit)), set: fromJulian(set) };
}

/* ---------- the moon ---------- */

export const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
export const moonAge = (d: Date) =>
  ((((d.getTime() - NEW_MOON) / DAY_MS) % SYNODIC) + SYNODIC) % SYNODIC;
export const moonLit = (d: Date) => (1 - Math.cos((2 * Math.PI * moonAge(d)) / SYNODIC)) / 2;
const PHASES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
];
export const moonPhase = (d: Date) => PHASES[Math.round((moonAge(d) / SYNODIC) * 8) % 8]!;

/** When the moon is next full (or new), from the mean cycle; good to within a day. */
export function nextMoon(d: Date, kind: 'full' | 'new'): Date {
  const target = kind === 'full' ? SYNODIC / 2 : 0;
  let days = (target - moonAge(d) + SYNODIC) % SYNODIC;
  if (days > SYNODIC - 0.5) days -= SYNODIC; // full tonight
  return new Date(d.getTime() + days * DAY_MS);
}

const MOON_NAMES = [
  'Wolf',
  'Snow',
  'Worm',
  'Pink',
  'Flower',
  'Strawberry',
  'Buck',
  'Sturgeon',
  'Harvest',
  'Hunter’s',
  'Beaver',
  'Cold',
];

/* ---------- seasons and showers ---------- */

/** March equinox, June solstice, September equinox, December solstice (Meeus, mean terms). */
export function seasons(year: number): Date[] {
  const Y = (year - 2000) / 1000;
  const jde = [
    2451623.80984 + 365242.37404 * Y + 0.05169 * Y ** 2 - 0.00411 * Y ** 3 - 0.00057 * Y ** 4,
    2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.0003 * Y ** 4,
    2451810.21715 + 365242.01767 * Y - 0.11575 * Y ** 2 + 0.00337 * Y ** 3 + 0.00078 * Y ** 4,
    2451900.05952 + 365242.74049 * Y - 0.06223 * Y ** 2 - 0.00823 * Y ** 3 + 0.00032 * Y ** 4,
  ];
  return jde.map((j) => new Date((j - 2440587.5) * DAY_MS));
}

/** Peak nights of the major meteor showers (month, day): the same every year to within a day. */
const SHOWERS: Array<[string, number, number, string]> = [
  ['Quadrantids', 1, 3, 'up to 100 an hour, before dawn'],
  ['Lyrids', 4, 22, 'about 18 an hour, after midnight'],
  ['Eta Aquariids', 5, 6, 'best before dawn'],
  ['Perseids', 8, 12, 'up to 100 an hour, after midnight'],
  ['Orionids', 10, 21, 'about 20 an hour, after midnight'],
  ['Leonids', 11, 17, 'about 15 an hour, after midnight'],
  ['Geminids', 12, 14, 'up to 150 an hour, all night'],
];

export interface SkyEvent {
  date: Date;
  title: string;
  sub: string;
  icon: string;
  /** Worth an Ambient line on the night. */
  night: boolean;
}

export function skyEvents(now: Date, lat: number, days = 120): SkyEvent[] {
  const north = lat >= 0;
  const today = startOfDay(now);
  const out: SkyEvent[] = [];
  // Full moons.
  let full = nextMoon(today, 'full');
  for (let i = 0; i < 5 && dayDiff(now, full) <= days; i++) {
    const name = north ? `Full ${MOON_NAMES[full.getMonth()]} Moon` : 'Full moon';
    out.push({ date: full, title: name, sub: 'Rises at sunset', icon: 'moon', night: true });
    full = new Date(full.getTime() + SYNODIC * DAY_MS);
  }
  // Seasons.
  const names = north
    ? [
        'First day of spring',
        'Longest day of the year',
        'First day of autumn',
        'Shortest day of the year',
      ]
    : [
        'First day of autumn',
        'Shortest day of the year',
        'First day of spring',
        'Longest day of the year',
      ];
  for (const y of [now.getFullYear(), now.getFullYear() + 1])
    seasons(y).forEach((d, i) =>
      out.push({
        date: d,
        title: names[i]!,
        sub: i % 2 ? 'Solstice' : 'Equinox',
        icon: 'sun',
        night: false,
      }),
    );
  // Meteor showers.
  for (const y of [now.getFullYear(), now.getFullYear() + 1])
    for (const [name, m, d, note] of SHOWERS) {
      const date = new Date(y, m - 1, d);
      const bright = moonLit(date) > 0.6;
      out.push({
        date,
        title: `${name} peak`,
        sub: bright ? `${note}; a bright moon hides the faint ones` : note,
        icon: 'sparkle',
        night: true,
      });
    }
  return out
    .filter((e) => dayDiff(now, e.date) >= 0 && dayDiff(now, e.date) <= days)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

const hm = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

export function skyCard(now: Date, lat: number, lon: number): PluginBlocksInput {
  const sun = sunTimes(now, lat, lon);
  const yesterday = sunTimes(addDays(now, -1), lat, lon);
  const lines: NonNullable<PluginBlocksInput['lines']> = [];
  if (sun) {
    const length = sun.set.getTime() - sun.rise.getTime();
    const diff = yesterday
      ? Math.round((length - (yesterday.set.getTime() - yesterday.rise.getTime())) / 60_000)
      : 0;
    const afterSunset = now > sun.set;
    const tomorrow = afterSunset ? sunTimes(addDays(now, 1), lat, lon) : null;
    lines.push({
      id: 'sun',
      icon: afterSunset ? 'sunrise' : now < sun.rise ? 'sunrise' : 'sunset',
      text:
        afterSunset && tomorrow
          ? `Sunrise ${clock(tomorrow.rise)} tomorrow`
          : now < sun.rise
            ? `Sunrise ${clock(sun.rise)}`
            : `Sunset ${clock(sun.set)}`,
      sub: `${now < sun.rise ? `Sunset ${clock(sun.set)} · ` : afterSunset ? '' : `Sunrise was ${clock(sun.rise)} · `}${hm(length)} of light${diff ? `, ${Math.abs(diff)} min ${diff > 0 ? 'more' : 'less'} than yesterday` : ''}`,
    });
  } else {
    lines.push({
      id: 'sun',
      icon: 'sun',
      text:
        Math.abs(lat) > 60 && lat > 0 === [4, 5, 6, 7].includes(now.getMonth())
          ? 'The sun does not set today'
          : 'The sun does not rise today',
      sub: '',
    });
  }
  const full = nextMoon(now, 'full');
  const fullIn = dayDiff(now, full);
  lines.push({
    id: 'moon',
    icon: 'moon',
    text: moonPhase(now),
    sub: `${Math.round(moonLit(now) * 100)}% lit · ${fullIn === 0 ? 'full tonight' : fullIn === 1 ? 'full tomorrow' : `full moon in ${fullIn} days`}`,
  });
  const next = skyEvents(now, lat).find((e) => !(e.icon === 'moon' && dayDiff(now, e.date) <= 1));
  if (next) {
    const extra = inDays(next.date, now);
    lines.push({
      id: 'event',
      icon: next.icon,
      text: next.title,
      sub: `${dayWord(next.date, now)}${extra ? ` · ${extra}` : ''}`,
    });
  }
  return { title: 'Sky', icon: 'sun', lines };
}

export function skyAmbient(now: Date, lat: number): PluginBlocksInput | null {
  if (now.getHours() < 15) return null;
  const tonight = skyEvents(now, lat, 0).find((e) => e.night);
  return tonight ? { title: `${tonight.title} tonight`, icon: tonight.icon, lines: [] } : null;
}

export function skyPlugin(_deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  const now = () => ctx?.now() ?? new Date();
  const where = () => {
    const loc = ctx?.settings().location;
    return { lat: loc?.latitude ?? 0, lon: loc?.longitude ?? 0, name: loc?.name ?? '' };
  };
  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply() {},
    async test(): Promise<TestResult> {
      const { lat, lon, name } = where();
      const sun = sunTimes(now(), lat, lon);
      return {
        ok: true,
        message: sun
          ? `${name || 'Home'}: sunrise ${clock(sun.rise)}, sunset ${clock(sun.set)}. ${moonPhase(now())}.`
          : `${moonPhase(now())}. No sunrise or sunset at this latitude today.`,
      };
    },
    status(): PluginStatusFields {
      const { lat, lon } = where();
      const sun = sunTimes(now(), lat, lon);
      return {
        state: 'connected',
        summary: sun ? `Sunrise ${clock(sun.rise)}, sunset ${clock(sun.set)}` : moonPhase(now()),
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      const { lat, lon } = where();
      if (name === 'card') return skyCard(now(), lat, lon);
      if (name === 'ambient') return skyAmbient(now(), lat);
      return undefined;
    },
  };
}
