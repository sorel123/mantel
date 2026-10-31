/** Pure formatting for the Home screen: sensor values, presence lines, thermostat numbers. */
import type { HomeEntity, Person, Presence } from '@mantel/shared';

export const fmtTime = (d: Date) => {
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
};

/** "now", "4 min", "2 hr", "3 days". */
export function since(iso: string | undefined, now: Date): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60e3));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const capitalise = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const isBinary = (e: HomeEntity) => e.id.startsWith('binary_sensor.');
export const isUnavailable = (e: HomeEntity) => e.state === 'unavailable' || e.state === 'unknown';

/** A short value for a sensor row, and whether it deserves attention. */
export function sensorValue(e: HomeEntity, now: Date): { text: string; warn: boolean } {
  if (isUnavailable(e)) return { text: 'Unavailable', warn: false };
  const dc = typeof e.attrs.device_class === 'string' ? e.attrs.device_class : '';
  const on = e.state === 'on';
  const ago = since(e.lastChanged, now);
  if (isBinary(e)) {
    if (['door', 'window', 'opening', 'garage_door'].includes(dc))
      return on
        ? { text: ago === 'now' ? 'Open' : `Open ${ago}`, warn: true }
        : { text: 'Closed', warn: false };
    if (['motion', 'occupancy', 'presence'].includes(dc))
      return on
        ? { text: 'Motion now', warn: false }
        : { text: ago ? (ago === 'now' ? 'Just now' : `${ago} ago`) : 'Clear', warn: false };
    if (dc === 'moisture') return on ? { text: 'Wet', warn: true } : { text: 'Dry', warn: false };
    if (['smoke', 'gas', 'carbon_monoxide', 'safety', 'problem', 'tamper'].includes(dc))
      return on ? { text: 'Alert', warn: true } : { text: 'OK', warn: false };
    if (dc === 'battery') return on ? { text: 'Low', warn: true } : { text: 'OK', warn: false };
    return { text: on ? 'On' : 'Off', warn: false };
  }
  const unit = typeof e.attrs.unit_of_measurement === 'string' ? e.attrs.unit_of_measurement : '';
  const n = Number(e.state);
  if (e.state.trim() !== '' && Number.isFinite(n)) {
    const rounded = Math.abs(n) >= 10 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1);
    if (unit === '°F' || unit === '°C') return { text: `${rounded}°`, warn: false };
    if (unit === '%') return { text: `${rounded}%`, warn: dc === 'battery' && n <= 15 };
    return { text: unit ? `${rounded} ${unit}` : String(rounded), warn: false };
  }
  return { text: capitalise(e.state), warn: false };
}

/** "Jay and Ava are home" over "Sam left 8:12 am · Leo is out". */
export function presenceLines(
  presence: Presence[],
  people: Person[],
  now: Date,
): { headline: string; detail: string } {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const list = (names: string[]) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const home = presence.filter((p) => p.home).map((p) => name(p.personId));
  const away = presence.filter((p) => !p.home);
  const headline = home.length
    ? `${list(home)} ${home.length === 1 ? 'is' : 'are'} home`
    : 'Nobody is home';
  const detail = away
    .map((p) => {
      const at = p.since ? new Date(p.since) : null;
      return at && sameDay(at, now)
        ? `${name(p.personId)} left ${fmtTime(at)}`
        : `${name(p.personId)} is out`;
    })
    .join(' · ');
  return { headline, detail: detail || (home.length ? 'Everyone is home' : '') };
}

/** The scene that ran last, if it ran in the past 12 hours and is not tied with another. */
export function activeScene(scenes: HomeEntity[], now: Date): string | null {
  const ran = scenes
    .map((s) => ({ id: s.id, t: s.lastChanged ? Date.parse(s.lastChanged) : NaN }))
    .filter((s) => Number.isFinite(s.t) && now.getTime() - s.t < 12 * 3600e3)
    .sort((a, b) => b.t - a.t);
  if (!ran.length || (ran[1] && ran[1].t === ran[0]!.t)) return null;
  return ran[0]!.id;
}

/** Brightness 0-255 to the slider's 1-100. */
export const toPct = (brightness: unknown) =>
  typeof brightness === 'number' ? Math.max(1, Math.round((brightness / 255) * 100)) : null;

/** Lights that can only switch on and off have no slider. */
export const dimmable = (e: HomeEntity) => {
  const modes = e.attrs.supported_color_modes;
  if (!Array.isArray(modes)) return typeof e.attrs.brightness === 'number';
  return modes.some((m) => m !== 'onoff');
};

export const isOn = (e: HomeEntity) => e.state === 'on';

export const HVAC_LABEL: Record<string, string> = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan',
};

export const HVAC_ACTION: Record<string, string> = {
  heating: 'Heating',
  cooling: 'Cooling',
  idle: 'Idle',
  off: 'Off',
  fan: 'Fan',
  drying: 'Drying',
  preheating: 'Preheating',
};

export const numAttr = (e: HomeEntity, key: string) => {
  const v = e.attrs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
