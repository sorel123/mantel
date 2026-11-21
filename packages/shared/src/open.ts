/**
 * v4 workstream O, "Open Mantel": API tokens with scopes, natural add (`POST /api/say`), the
 * spoken summary for Siri (`GET /api/today.txt`), the state Home Assistant reads, and the MCP
 * endpoint's tool names. The routes here are spread into the route table in `api.ts`.
 *
 * A token is sent as `Authorization: Bearer mtl_...`. Device keys keep working unchanged; a
 * token is only ever checked when a request carries no valid device key.
 */
import { z } from 'zod';

// Local copies: models.ts imports `OpenSettings` from here, so this file cannot import it.
const Id = z.string().min(1);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const IsoDateTime = z.iso.datetime({ offset: true });

const NoQuery = z.object({}).strict();
const NoBody = z.undefined();
const Ok = z.object({ ok: z.literal(true) });

/* ---------- tokens ---------- */

export const TokenScope = z.enum([
  'read',
  'lists',
  'calendar',
  'meals',
  'chores',
  'capture',
  'admin',
]);
export type TokenScope = z.infer<typeof TokenScope>;
export const TOKEN_SCOPES = TokenScope.options;

export const TOKEN_SCOPE_LABELS: Record<TokenScope, { label: string; hint: string }> = {
  read: { label: 'Read', hint: 'See the calendar, lists, meals, chores, notes and weather.' },
  lists: { label: 'Lists', hint: 'Add, tick off and remove list items.' },
  calendar: { label: 'Calendar', hint: 'Add, change and delete events.' },
  meals: { label: 'Meals', hint: 'Plan meals and send ingredients to the grocery list.' },
  chores: { label: 'Chores', hint: 'Mark chores done and undo them.' },
  capture: {
    label: 'Voice and notes',
    hint: 'Say things to Mantel ("milk and eggs", "dentist Tuesday at 3") and post wall notes.',
  },
  admin: { label: 'Everything', hint: 'Every route a paired display can use. Keep this one safe.' },
};

/** The prefix every token starts with, so a leaked one is easy to recognise and search for. */
export const TOKEN_PREFIX = 'mtl_';
/** Header for clients that cannot set `Authorization` (it is also accepted there). */
export const TOKEN_HEADER = 'x-mantel-token';

/** Ready-made scope sets for the "New token" sheet. */
export const TOKEN_PRESETS: Array<{
  id: string;
  name: string;
  scopes: TokenScope[];
  hint: string;
}> = [
  {
    id: 'siri',
    name: 'Siri',
    scopes: ['read', 'capture'],
    hint: 'Add by voice and hear what is on today.',
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    scopes: ['read', 'lists', 'chores', 'capture'],
    hint: 'Sensors, calendars, and adding from Alexa or Assist through Home Assistant.',
  },
  {
    id: 'claude',
    name: 'Claude',
    scopes: ['read', 'lists', 'calendar', 'meals', 'capture'],
    hint: 'Let Claude read and add to the family calendar, lists and meals.',
  },
];

export const ApiToken = z.object({
  id: Id,
  name: z.string(),
  scopes: z.array(TokenScope),
  /** The first characters of the secret (`mtl_ab12`), to tell tokens apart. */
  prefix: z.string(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
});
export type ApiToken = z.infer<typeof ApiToken>;

export const TokensResponse = z.object({ tokens: z.array(ApiToken) });
export const TokenCreateRequest = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(TokenScope).min(1).max(TOKEN_SCOPES.length),
  /** The admin PIN. Not needed in mock mode. */
  pin: z.string().max(12).optional(),
});
export const TokenCreateResponse = z.object({
  token: ApiToken,
  /** Shown once. Only its hash is stored. */
  secret: z.string(),
});
export const TokenRevokeRequest = z.object({ pin: z.string().max(12).optional() });

/**
 * Which token scopes may use an existing contract route. A route that is not listed here
 * answers only to device keys and `admin` tokens. `read` covers the plain GET routes.
 */
export const TOKEN_ROUTE_SCOPES: Record<string, TokenScope[]> = {
  bootstrap: ['read'],
  calendar: ['read', 'calendar'],
  countdowns: ['read', 'calendar'],
  meals: ['read', 'meals'],
  mealsWeek: ['read', 'meals'],
  weather: ['read'],
  commute: ['read'],
  lists: ['read', 'lists'],
  chores: ['read', 'chores'],
  notes: ['read', 'capture'],
  starsBalance: ['read', 'chores'],
  rewards: ['read', 'chores'],
  displayState: ['read'],
  calendarQuick: ['calendar'],
  calendarEventPatch: ['calendar'],
  calendarEventDelete: ['calendar'],
  listAddItem: ['lists'],
  itemPatch: ['lists'],
  itemDelete: ['lists'],
  mealsPlan: ['meals'],
  choreDone: ['chores'],
  choreUndo: ['chores'],
  noteCreate: ['capture'],
  // This workstream's own routes.
  say: ['capture', 'lists', 'calendar', 'meals'],
  openState: ['read'],
  todayText: ['read'],
};

/* ---------- natural add ---------- */

export const SaySource = z.enum(['voice', 'share', 'text', 'mcp']);
export type SaySource = z.infer<typeof SaySource>;

export const SayRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  /** Who is speaking, when the caller knows (a phone, a voice profile). */
  personId: Id.optional(),
  /** Work out what would happen and say it, without adding anything. */
  dryRun: z.boolean().optional(),
  source: SaySource.optional(),
});
export type SayRequest = z.input<typeof SayRequest>;

export const MealSlotWord = z.enum(['breakfast', 'lunch', 'dinner']);

/** What a phrase turned into. */
export const SayAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('items'),
    /** Null when no list exists yet; one named `listName` is created. */
    listId: Id.nullable(),
    listName: z.string(),
    items: z.array(z.string().min(1).max(200)).min(1).max(30),
  }),
  z.object({
    kind: z.literal('event'),
    title: z.string().min(1).max(200),
    date: IsoDate,
    /** `HH:MM`, 24-hour; absent for all-day. */
    start: z.string().optional(),
    end: z.string().optional(),
    allDay: z.boolean(),
    personIds: z.array(Id),
    location: z.string().optional(),
  }),
  z.object({
    kind: z.literal('meal'),
    date: IsoDate,
    slot: MealSlotWord,
    title: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('note'),
    text: z.string().min(1).max(280),
    personId: Id.optional(),
  }),
  z.object({ kind: z.literal('none'), reason: z.string() }),
]);
export type SayAction = z.infer<typeof SayAction>;
export type SayKind = SayAction['kind'];

export const SayResponse = z.object({
  /** False when nothing was added (an empty phrase, a failure, or `none`). */
  ok: z.boolean(),
  /** A short sentence for Siri or Alexa to speak back. */
  speech: z.string(),
  action: SayAction,
  /** `rules` with no Claude key, or when Claude could not be reached. */
  parser: z.enum(['rules', 'claude']),
  dryRun: z.boolean(),
});
export type SayResponse = z.infer<typeof SayResponse>;

/** `settings.open`: how Mantel handles things said to it. */
export const OpenSettings = z.object({
  /** Where "milk and eggs" goes; null picks the list named Grocery (or the first list). */
  defaultListId: Id.nullable().default(null),
  /** With a Claude key saved, let Claude read phrases the rules are unsure about. */
  claudeParsing: z.boolean().default(true),
});
export type OpenSettings = z.infer<typeof OpenSettings>;
export const DEFAULT_OPEN_SETTINGS: OpenSettings = { defaultListId: null, claudeParsing: true };

/* ---------- what Home Assistant reads ---------- */

export const OpenActivity = z.object({
  /** Unique and increasing for the life of the server. */
  id: z.string(),
  type: z.enum(['chore_done', 'reward_redeemed', 'said']),
  at: IsoDateTime,
  personId: Id.nullable(),
  personName: z.string().nullable(),
  title: z.string(),
  stars: z.number().int().nullable(),
});
export type OpenActivity = z.infer<typeof OpenActivity>;

export const OpenState = z.object({
  version: z.string(),
  timezone: z.string(),
  at: IsoDateTime,
  tonight: z.object({ dinner: z.string().nullable() }),
  nextEvent: z
    .object({
      title: z.string(),
      start: IsoDateTime,
      allDay: z.boolean(),
      personIds: z.array(Id),
    })
    .nullable(),
  /** Items waiting in the inbox (workstream K); 0 until it exists. */
  inboxCount: z.number().int().nonnegative(),
  groceryList: z.object({ id: Id, name: z.string(), open: z.number().int() }).nullable(),
  lists: z.array(z.object({ id: Id, name: z.string(), open: z.number().int() })),
  people: z.array(
    z.object({
      id: Id,
      name: z.string(),
      choresOpen: z.number().int(),
      choresDone: z.number().int(),
      stars: z.number().int(),
    }),
  ),
  calendars: z.array(z.object({ id: Id, name: z.string(), color: z.string() })),
  /** Recent chore completions and redeemed rewards, newest last. */
  activity: z.array(OpenActivity),
});
export type OpenState = z.infer<typeof OpenState>;

export const TodayTextQuery = z
  .object({
    day: z.enum(['today', 'tomorrow']).optional(),
    format: z.enum(['text', 'json']).optional(),
  })
  .strict();

/* ---------- MCP ---------- */

export const MCP_PATH = '/mcp';

/* ---------- routes (merged into `routes` in api.ts) ---------- */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const def = <
  M extends Method,
  P extends string,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType | null,
>(d: {
  method: M;
  path: P;
  query: Q;
  body: B;
  response: R;
  auth: boolean;
}) => d;

export const openRoutes = {
  openTokens: def({
    method: 'GET',
    path: '/open/tokens',
    query: NoQuery,
    body: NoBody,
    response: TokensResponse,
    auth: true,
  }),
  openTokenCreate: def({
    method: 'POST',
    path: '/open/tokens',
    query: NoQuery,
    body: TokenCreateRequest,
    response: TokenCreateResponse,
    auth: true,
  }),
  openTokenRevoke: def({
    method: 'POST',
    path: '/open/tokens/:id/revoke',
    query: NoQuery,
    body: TokenRevokeRequest,
    response: Ok,
    auth: true,
  }),
  /** Turn a phrase into an action: list items, an event, a meal or a wall note. */
  say: def({
    method: 'POST',
    path: '/say',
    query: NoQuery,
    body: SayRequest,
    response: SayResponse,
    auth: true,
  }),
  /** Everything Home Assistant's sensors show, in one call. */
  openState: def({
    method: 'GET',
    path: '/open/state',
    query: NoQuery,
    body: NoBody,
    response: OpenState,
    auth: true,
  }),
  /** The day as a few spoken sentences, for Siri ("What's on today"). */
  todayText: def({
    method: 'GET',
    path: '/today.txt',
    query: TodayTextQuery,
    body: NoBody,
    response: null,
    auth: true,
  }),
};
