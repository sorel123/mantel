/**
 * Shapes the settings page uses that are not in the shared route table: WS2's calendar setup
 * JSON (`/api/calendar/setup/*`, kept as it is) and display-side labels. Everything else comes
 * from `@mantel/shared` (workstream A's `integrations.ts` and `plugins.ts`).
 */

/** `GET /api/calendar/setup/state`. */
export interface CalendarSetupState {
  google: {
    configured: boolean;
    connected: boolean;
    lastSync: string | null;
    error: string | null;
    account: string | null;
    revoked: boolean;
    redirectUri: string;
    pasteBack: boolean;
    push: boolean;
    pushActive: boolean;
  };
  icloud: {
    configured: boolean;
    connected: boolean;
    lastSync: string | null;
    error: string | null;
    username: string | null;
  };
  people: Array<{ id: string; name: string; color: string }>;
  defaultCalendarId: string | null;
  calendars: Array<{
    id: string;
    name: string;
    source: 'google' | 'icloud';
    color: string;
    personIds: string[];
    readOnly: boolean;
    isMeals: boolean;
    sourceName: string;
    sourceColor: string;
    enabled: boolean;
    primary: boolean;
  }>;
}

/** `POST /api/calendar/setup/prefs`. */
export interface CalendarPrefs {
  calendars: Record<
    string,
    { enabled?: boolean; name?: string; color?: string; personIds?: string[]; isMeals?: boolean }
  >;
  defaultCalendarId?: string;
}

/** Names for the screen ids the dock knows. A screen added later shows under its id. */
export const SCREEN_LABELS: Record<string, string> = {
  today: 'Today',
  month: 'Month',
  lists: 'Lists',
  home: 'Home',
};

/** The settings sections, in the order the left nav and the wizard use them. */
export type SectionId =
  | 'home'
  | 'people'
  | 'calendars'
  | 'integrations'
  | 'homeassistant'
  | 'appearance'
  | 'layout'
  | 'screens'
  | 'lists'
  | 'places'
  | 'schedule'
  | 'features'
  | 'displays'
  | 'health'
  | 'backup'
  | 'help'
  | 'advanced';
