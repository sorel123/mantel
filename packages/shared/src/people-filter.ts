/**
 * The wall's person filter: who is tapping. Pure logic shared by the display (agenda, Month,
 * dock) and anything else that wants to answer "is this for the chosen person?". The state is
 * per display and never saved on the server: a person choice lapses after a minute without a
 * touch (longer while a sheet is open), and guest mode lasts for the browser session.
 */

/** A person choice clears after this long without a touch. */
export const PERSON_FILTER_IDLE_MS = 60_000;
/** ...or this long while a sheet or dialog is open (someone is reading or typing). */
export const PERSON_FILTER_SHEET_MS = 5 * 60_000;
/** Where guest mode is remembered (`sessionStorage`), so a reload keeps it. */
export const GUEST_STORAGE_KEY = 'mantel.guest';
/** Screens a guest sees. Lists, chores and the Home screen (cameras, locks) are hidden. */
export const GUEST_SCREENS = ['today', 'month'] as const;

export interface PersonFilter {
  /** The person whose things are highlighted, or null for everyone. */
  personId: string | null;
  /** Guest mode: calendar, weather and photos only. */
  guest: boolean;
}

export const NO_FILTER: PersonFilter = { personId: null, guest: false };

/**
 * True when something belonging to `personIds` stays bright under the filter. Nothing is dimmed
 * without a choice, and things that name nobody (the family calendar, a shared list) belong to
 * everyone, so they stay bright too.
 */
export function forPerson(personIds: readonly string[], personId: string | null): boolean {
  return !personId || personIds.length === 0 || personIds.includes(personId);
}

/** The opposite of `forPerson`: draw it dimmed. */
export const dimmedFor = (personIds: readonly string[], personId: string | null) =>
  !forPerson(personIds, personId);

/**
 * Whether a person choice made earlier has lapsed: `lastTouch` is the last pointer down on the
 * panel, `sheetOpen` is true while a sheet or dialog is up.
 */
export function personFilterExpired(lastTouch: number, now: number, sheetOpen: boolean): boolean {
  return now - lastTouch >= (sheetOpen ? PERSON_FILTER_SHEET_MS : PERSON_FILTER_IDLE_MS);
}

/** Tapping a person chip: choose them, or clear when they were already chosen. */
export const togglePerson = (current: string | null, id: string): string | null =>
  current === id ? null : id;

/** Whether a screen shows in guest mode. */
export const guestAllows = (screenId: string) =>
  (GUEST_SCREENS as readonly string[]).includes(screenId);
