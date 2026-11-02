import { useCallback, useEffect, useState } from 'react';

/**
 * "Stay on this screen": holds the display out of Ambient for a while, or until it is turned
 * off. Kept per display in local storage, so a reload (after a settings change, say) keeps it.
 */
const KEY = 'mantel.keepAwake';

/** Until when, in epoch ms; `Infinity` means until someone turns it off. */
export type AwakeUntil = number | null;

function read(): AwakeUntil {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = raw === 'forever' ? Infinity : Number(raw);
    return Number.isFinite(v) && v <= Date.now() ? null : v;
  } catch {
    return null;
  }
}

function write(v: AwakeUntil) {
  try {
    if (v === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v === Infinity ? 'forever' : String(v));
  } catch {
    // Private mode or blocked storage: the hold still works until the page reloads.
  }
}

export function useKeepAwake() {
  const [until, setUntil] = useState<AwakeUntil>(read);
  useEffect(() => {
    if (until === null || until === Infinity) return;
    const t = setTimeout(
      () => {
        write(null);
        setUntil(null);
      },
      Math.max(0, until - Date.now()),
    );
    return () => clearTimeout(t);
  }, [until]);
  const hold = useCallback((minutes: number | null) => {
    const v = minutes === null ? Infinity : Date.now() + minutes * 60_000;
    write(v);
    setUntil(v);
  }, []);
  const release = useCallback(() => {
    write(null);
    setUntil(null);
  }, []);
  return { until, held: until !== null, hold, release };
}

/** "until 9:41", "until you turn it off". */
export function awakeLabel(until: AwakeUntil, now = new Date()): string {
  if (until === null) return '';
  if (until === Infinity) return 'until you turn it off';
  const d = new Date(until);
  const h = ((d.getHours() + 11) % 12) + 1;
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const tomorrow = d.toDateString() !== now.toDateString() ? ' tomorrow' : '';
  return `until ${h}:${m} ${ampm}${tomorrow}`;
}

export const AWAKE_CHOICES: Array<{ label: string; minutes: number | null }> = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until I turn it off', minutes: null },
];
