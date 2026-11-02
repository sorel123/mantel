import { useEffect, useState } from 'react';

/** The current time, refreshed on the minute (and every `intervalMs` as a fallback). */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `7:42` */
export const formatClock = (d: Date) =>
  `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;

/** `7:42 am` or `7 am` */
export const formatTime = (d: Date, { minutes = true } = {}) => {
  const ap = d.getHours() >= 12 ? 'pm' : 'am';
  const hh = ((d.getHours() + 11) % 12) + 1;
  return minutes || d.getMinutes()
    ? `${hh}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`
    : `${hh} ${ap}`;
};

/** `Friday, October 31` */
export const formatLongDate = (d: Date) =>
  `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;

/** The dock's date beside the clock: `Sun 2` (`day`), `Sun, Nov 2` (`date`) or nothing. */
export function formatDockDate(
  d: Date,
  style: 'off' | 'day' | 'date' | undefined,
): string | undefined {
  if (!style || style === 'off') return undefined;
  const day = DAY_NAMES[d.getDay()]!.slice(0, 3);
  if (style === 'day') return `${day} ${d.getDate()}`;
  return `${day}, ${MONTH_NAMES[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}
