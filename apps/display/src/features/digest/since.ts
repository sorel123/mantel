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
 * Loads what changed since the mark. The first time a device ever asks, it starts from now
 * (nothing to catch up on), so a new display does not open with a month of history.
 */
export function useSince(place: string, enabled = true): Since {
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
      if (!mark) {
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
    void load();
  }, [load]);

  const onAdded = useCallback(
    ({ entry }: { entry: ActivityEntry }) => {
      if (!enabled) return;
      const mark = readMark(place);
      if (mark && Date.parse(entry.at) <= Date.parse(mark)) return;
      setEntries((list) => (list.some((e) => e.id === entry.id) ? list : [entry, ...list]));
    },
    [place, enabled],
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
