/**
 * The wall's person filter as a tiny store: tap a person's chip (agenda header, dock) to
 * highlight their things and dim the rest; tap again, or leave the wall alone for a minute, to
 * clear it. Guest mode hides lists, chores and the Home screen until it is tapped off, and lasts
 * for the browser session. Rules live in `@mantel/shared` (`people-filter.ts`).
 */
import type { Person } from '@mantel/shared';
import {
  GUEST_STORAGE_KEY,
  NO_FILTER,
  dimmedFor,
  personFilterExpired,
  togglePerson,
  type PersonFilter,
} from '@mantel/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { Avatar, pc } from './parts';

function readGuest(): boolean {
  try {
    return sessionStorage.getItem(GUEST_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let state: PersonFilter = { ...NO_FILTER, guest: readGuest() };
let lastTouch = Date.now();
const listeners = new Set<() => void>();

function set(next: PersonFilter) {
  if (next.personId === state.personId && next.guest === state.guest) return;
  state = next;
  lastTouch = Date.now();
  for (const l of listeners) l();
}

export const personFilter = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Choose a person, or clear when they were already chosen. */
  toggle: (id: string) => set({ ...state, personId: togglePerson(state.personId, id) }),
  choose: (personId: string | null) => set({ ...state, personId }),
  setGuest(guest: boolean) {
    try {
      if (guest) sessionStorage.setItem(GUEST_STORAGE_KEY, '1');
      else sessionStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // Storage blocked: guest mode lasts until the page reloads.
    }
    set({ personId: null, guest });
  },
  /** For tests. */
  reset() {
    state = { ...NO_FILTER, guest: readGuest() };
    for (const l of listeners) l();
  },
};

export function usePersonFilter(): PersonFilter {
  return useSyncExternalStore(personFilter.subscribe, personFilter.get, personFilter.get);
}

/** `(personIds) => true` when that thing should be drawn dimmed under the current choice. */
export function useDimmed(): (personIds: readonly string[]) => boolean {
  const { personId } = usePersonFilter();
  return (ids) => dimmedFor(ids, personId);
}

/** ` dim` for a class list when dimmed, else ''. */
export const dimClass = (dim: boolean) => (dim ? ' pf-dim' : '');

/**
 * Clears the person choice after a minute without a touch (five while a sheet is open). Mount
 * once, inside the display (the dock does).
 */
export function usePersonFilterTimeout(sheetOpen: boolean) {
  useEffect(() => {
    const touch = () => {
      lastTouch = Date.now();
    };
    window.addEventListener('pointerdown', touch, { capture: true, passive: true });
    const t = setInterval(() => {
      if (state.personId && personFilterExpired(lastTouch, Date.now(), sheetOpen))
        set({ ...state, personId: null });
    }, 2000);
    return () => {
      window.removeEventListener('pointerdown', touch, { capture: true });
      clearInterval(t);
    };
  }, [sheetOpen]);
}

/**
 * The household as toggle chips: tap one to highlight their things, tap again to clear. Used in
 * the agenda header and the dock.
 */
export function PersonChips({
  people,
  small,
  className = '',
}: {
  people?: Person[];
  small?: boolean;
  className?: string;
}) {
  const boot = useBootstrap();
  const list = people ?? boot.people;
  const { personId } = usePersonFilter();
  if (!list.length) return null;
  return (
    <span
      className={`pf-chips${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Show one person"
    >
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`pf-chip${personId === p.id ? ' on' : ''}${personId && personId !== p.id ? ' off' : ''}`}
          style={pc(p.color)}
          aria-pressed={personId === p.id}
          aria-label={personId === p.id ? `Showing ${p.name}. Show everyone` : `Show ${p.name}`}
          onClick={() => personFilter.toggle(p.id)}
        >
          <Avatar person={p} small={small} />
        </button>
      ))}
    </span>
  );
}
