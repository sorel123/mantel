/**
 * "Since you last looked": the changes since this device last showed the strip. The mark is
 * per device and per place (the wall's Today, the phone), kept in local storage, and moves to
 * the server's clock when the strip clears, so a phone with a wrong clock still behaves.
 */
import { summariseActivity, type ActivityEntry, type SinceLine } from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useServerEvent } from '../../lib/events';

const KEY = (place: string) => `mantel.since.${place}`;

export function readMark(place: string): string | null {
  try {
    return localStorage.getItem(KEY(place));
  } catch {
    return null;
  }
}

export function writeMark(place: string, iso: string) {
  try {
    localStorage.setItem(KEY(place), iso);
  } catch {
    // Private mode: the strip just shows again next time.
  }
}

export interface Since {
  lines: SinceLine[];
  entries: ActivityEntry[];
  loading: boolean;
  /** Mark everything seen (the strip clears). */
  clear: () => void;
}

/**
 * Loads what changed since the mark, each time `active` turns on (the Today screen shows, the
 * phone app opens or comes back). The first time a device ever asks, it starts from now, so a
 * new display does not open with a month of history; with nothing new, looking moves the mark.
 * Changes that arrive while the strip is up join it; while nothing is showing they wait for
 * the next look, so the wall never pops a strip over what someone is doing right now.
 */
export function useSince(place: string, enabled = true, active = true, refreshKey = 0): Since {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const serverNow = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mark = readMark(place);
    try {
      const r = await api.call('activity', {
        query: mark ? { since: mark, limit: 60 } : { limit: 1 },
      });
      serverNow.current = r.now;
      if (!mark || r.entries.length === 0) {
        writeMark(place, r.now);
        setEntries([]);
      } else setEntries(r.entries);
    } catch {
      // Offline: keep what is showing.
    } finally {
      setLoading(false);
    }
  }, [place, enabled]);

  useEffect(() => {
    if (active) void load();
  }, [load, active, refreshKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && active) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, active]);

  const onAdded = useCallback(
    ({ entry }: { entry: ActivityEntry }) => {
      if (!enabled) return;
      setEntries((list) =>
        list.length === 0 || list.some((e) => e.id === entry.id) ? list : [entry, ...list],
      );
    },
    [enabled],
  );
  useServerEvent('activity.added', onAdded);

  const clear = useCallback(() => {
    const newest = entries.reduce(
      (max, e) => (Date.parse(e.at) > Date.parse(max) ? e.at : max),
      serverNow.current ?? new Date().toISOString(),
    );
    writeMark(place, newest);
    setEntries([]);
  }, [entries, place]);

  return { lines: summariseActivity(entries, 5), entries, loading, clear };
}
