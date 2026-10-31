/** Date helpers shared by the server, fixtures and display. All work in the runtime's local timezone. */

const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, '0');

/** ISO 8601 with the local offset, e.g. `2026-10-31T09:30:00-07:00`. */
export function toLocalIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

/** `YYYY-MM-DD` for the local date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse `YYYY-MM-DD` as local midnight. */
export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Local midnight on the Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

/** A local Date on `day` at fractional hour `h` (7.5 = 7:30). */
export function atHour(day: Date, h: number): Date {
  const x = startOfDay(day);
  x.setMinutes(Math.round(h * 60));
  return x;
}

/** Whole days from the start of `from`'s day to the start of `to`'s day. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 864e5);
}
