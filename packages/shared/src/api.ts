/**
 * The REST contract. All routes live under `/api`, speak JSON, and require the device-key
 * header except `POST /api/pair` and `GET /api/health`.
 *
 * Each entry names the method, the path (Hono-style `:params`), and zod schemas for the
 * query string, request body and response body. The server validates against these and the
 * display's client is typed from them, so a route's shape changes in exactly one place.
 */
import { z } from 'zod';
import {
  AdminPinRequest,
  AdminPinResponse,
  AuthorizeUrlResponse,
  ExportRequest,
  GeocodeRequest,
  GeocodeResponse,
  HealthDetails,
  ImportRequest,
  ImportResponse,
  IntegrationPatch,
  IntegrationResponse,
  IntegrationsResponse,
  OAuthCallbackRequest,
  PutSetupStateRequest,
  SettingsBundle,
  SetupState,
  TestRequest,
  TestResult,
} from './integrations.js';
import { PluginsResponse } from './plugins.js';
import {
  Calendar,
  CalendarEvent,
  Chore,
  ChoreCadence,
  Countdown,
  Device,
  DeviceOverrides,
  DisplayState,
  FeatureFlags,
  HomeArea,
  HomeEntity,
  Id,
  IntegrationToggles,
  IsoDate,
  IsoDateTime,
  Layout,
  LeaveBy,
  List,
  ListItem,
  Meal,
  MediaAction,
  MediaPlayer,
  PanelSize,
  Person,
  Photo,
  Presence,
  ScreenConfig,
  ScreenSchedule,
  Settings,
  StarTally,
  ThemeMode,
  Units,
  Location,
} from './models.js';
import { Appearance } from './skins.js';
import {
  HomeConfig,
  HomeConnectionPatch,
  HomeConnectionStatus,
  HomeConnectionTestRequest,
  HomeDiscovery,
  HomeTestResult,
  HomeYaml,
} from './home-setup.js';
import {
  WeatherPlaceQuery,
  WeatherQuipResponse,
  WeatherSearchQuery,
  WeatherSearchResponse,
  WeatherSnapshotExtended,
} from './weather-extended.js';

export const API_PREFIX = '/api';
export const WS_PATH = '/ws';
/** The panel the display lays out for (iPad landscape). The Surface runs at 1440 by 960. */
export const DEFAULT_PANEL = { width: 1180, height: 820 };

/** Header carrying the device key. Browsers cannot set headers on WebSockets, so `/ws` takes `?key=` instead. */
export const DEVICE_KEY_HEADER = 'x-mantel-device-key';

export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      'bad_request',
      'unauthorized',
      'forbidden',
      'not_found',
      'not_implemented',
      'upstream_error',
      'internal',
      /** The integration is turned off in settings (Home Assistant, for example). */
      'disabled',
    ]),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

/* ---------- request and response schemas ---------- */

/** Pair with the rotating 6-digit code from the log (or a paired display), or with the admin PIN. */
export const PairRequest = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    pin: z
      .string()
      .regex(/^\d{4,8}$/)
      .optional(),
    name: z.string().min(1).max(60).optional(),
  })
  .refine((r) => r.code || r.pin, { message: 'give a pairing code or the admin PIN' });
export const PairResponse = z.object({ deviceId: Id, deviceKey: z.string().min(16) });

/** Whether a newer Mantel release is out. `checked: false` when the check is off or could not run. */
export const UpdateCheckResponse = z.object({
  current: z.string(),
  checked: z.boolean(),
  latest: z.string().nullable(),
  available: z.boolean(),
  /** The release page to download from. */
  url: z.string().nullable(),
  notes: z.string().nullable(),
});
export type UpdateCheckResponse = z.infer<typeof UpdateCheckResponse>;

export const BootstrapResponse = z.object({
  version: z.string(),
  mock: z.boolean(),
  serverTime: IsoDateTime,
  timezone: z.string(),
  people: z.array(Person),
  calendars: z.array(Calendar),
  settings: z.object({
    location: Location,
    units: Units,
    schedule: ScreenSchedule,
    appearance: Appearance,
    layout: Layout,
    screens: z.array(ScreenConfig),
    defaultScreen: Id,
    integrations: IntegrationToggles,
  }),
  theme: ThemeMode,
  panel: PanelSize,
  flags: FeatureFlags,
  /** The requesting display's record, with its per-display overrides. Null in mock mode without a pairing. */
  device: Device.nullable(),
});

export const CalendarQuery = z.object({ from: IsoDateTime, to: IsoDateTime });
export const CalendarResponse = z.object({ events: z.array(CalendarEvent) });

export const QuickEventRequest = z.object({
  title: z.string().min(1),
  start: IsoDateTime,
  /** Defaults to one hour after start (or the next day for all-day events). */
  end: IsoDateTime.optional(),
  allDay: z.boolean().optional(),
  /** Defaults to the family calendar configured on the server. */
  calendarId: Id.optional(),
  personIds: z.array(Id).optional(),
});
export const QuickEventResponse = z.object({ event: CalendarEvent });

/** Change an event; fields left out stay as they are. */
export const EventPatchRequest = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  start: IsoDateTime.optional(),
  end: IsoDateTime.optional(),
  allDay: z.boolean().optional(),
  /** Empty string clears it. */
  location: z.string().max(300).optional(),
  personIds: z.array(Id).optional(),
});

export const CountdownsResponse = z.object({ countdowns: z.array(Countdown) });

/** `week` is any date in the wanted week; omitted means this week. Weeks start on Monday. */
export const MealsQuery = z.object({ week: IsoDate.optional() });
export const MealsResponse = z.object({ weekStart: IsoDate, meals: z.array(Meal) });

export const WeatherResponse = WeatherSnapshotExtended;

export const CommuteResponse = z.object({
  /** Empty outside the weekday morning window. */
  leaveBy: z.array(LeaveBy),
});

export const PhotosNextQuery = z.object({ n: z.coerce.number().int().min(1).max(50).optional() });
export const PhotoRef = Photo.extend({
  /** Server-relative URL of the bytes, sized for the panel: `/api/photos/:id`. */
  url: z.string(),
});
export type PhotoRef = z.infer<typeof PhotoRef>;
export const PhotosNextResponse = z.object({ photos: z.array(PhotoRef) });

/** An Echo (or group) that Alexa announcements can go to. */
export const AnnounceTarget = z.object({ id: Id, name: z.string() });
export type AnnounceTarget = z.infer<typeof AnnounceTarget>;

export const HomeStateResponse = z.object({
  areas: z.array(HomeArea),
  entities: z.array(HomeEntity),
  presence: z.array(Presence),
  /** Where Alexa announcements can go; empty or missing when announcements are not set up. */
  announceTargets: z.array(AnnounceTarget).optional(),
});

export const HomeCallRequest = z.object({
  entityId: Id,
  /** Service name without the domain: `turn_on`, `toggle`, `set_temperature`, `unlock`... The domain comes from the entity id. */
  service: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});
export const HomeCallResponse = z.object({ ok: z.literal(true), entity: HomeEntity.optional() });

/**
 * Query for byte routes the display loads with `<img src>`, which cannot send headers: the
 * device key rides in `?key=` (as on `/ws`), and `t` is a cache-buster.
 */
export const ImageQuery = z.object({ key: z.string().optional(), t: z.string().optional() });

/** Speak a message on Echo devices through Alexa Media Player. Needs the `alexaAnnouncements` flag. */
export const AnnounceRequest = z.object({
  message: z.string().trim().min(1).max(200),
  /** Announce target ids from `/home/state`; omitted means every target. */
  targets: z.array(Id).min(1).optional(),
});
export const AnnounceResponse = z.object({ ok: z.literal(true), targets: z.array(Id) });

export const MediaResponse = z.object({ players: z.array(MediaPlayer) });
export const MediaCallRequest = z.object({ playerId: Id, action: MediaAction });
export const MediaCallResponse = z.object({ ok: z.literal(true), player: MediaPlayer });

export const ListsResponse = z.object({ lists: z.array(List) });
export const AddItemRequest = z.object({ text: z.string().min(1), personId: Id.optional() });
export const ItemResponse = z.object({ item: ListItem });
export const PatchItemRequest = z
  .object({ text: z.string().min(1), done: z.boolean(), personId: Id.nullable() })
  .partial();

export const ChoresResponse = z.object({
  weekStart: IsoDate,
  chores: z.array(Chore),
  stars: z.array(StarTally),
});
export const ChoreDoneResponse = z.object({ chore: Chore, stars: z.array(StarTally) });

export const CreateListRequest = z.object({ name: z.string().trim().min(1).max(60) });
export const ListResponse = z.object({ list: List });
/** Rename a list, or make it (or stop it being) the one on the Today screen. */
export const PatchListRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  home: z.boolean().optional(),
});
/** Every list id in the new order; lists left out keep their place after these. */
export const ReorderListsRequest = z.object({ ids: z.array(Id).max(200) });

export const CreateChoreRequest = z.object({
  title: z.string().trim().min(1).max(80),
  personId: Id,
  cadence: ChoreCadence,
  /** Stars per completion. */
  stars: z.number().int().min(1).max(5).default(1),
  /** Completions needed per period. */
  target: z.number().int().min(1).max(7).default(1),
});
export const ChoreResponse = z.object({ chore: Chore });

export const SettingsResponse = Settings;
export const PutSettingsRequest = Settings;

export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  mock: z.boolean(),
  uptimeSeconds: z.number().nonnegative(),
  /** Last successful sync per source (`calendar`, `weather`, `photos`, `home`, `lists`...), null if never. */
  lastSync: z.record(z.string(), IsoDateTime.nullable()),
});

export const DevicesResponse = z.object({ devices: z.array(Device) });
/** Rename, and/or set per-display overrides (`null` clears one). At least one field. */
export const RenameDeviceRequest = DeviceOverrides.extend({
  name: z.string().trim().min(1).max(60),
})
  .partial()
  .refine((r) => Object.keys(r).length > 0, { message: 'nothing to change' });
export const PatchDeviceRequest = RenameDeviceRequest;
export const DeviceResponse = z.object({ device: Device });
export const PairingCodeResponse = z.object({
  /** The code `POST /pair` accepts right now, for pairing another display from this one. */
  code: z.string().regex(/^\d{6}$/),
  expiresAt: IsoDateTime,
});
export const DisplayStateResponse = DisplayState;
export const DisplayReloadResponse = z.object({
  ok: z.literal(true),
  /** Displays connected when the reload was sent. */
  clients: z.number().int().nonnegative(),
});

/* ---------- the route table ---------- */

export interface RouteDef<
  M extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' =
    'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  P extends string = string,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType | null = z.ZodType | null,
> {
  method: M;
  path: P;
  query: Q;
  body: B;
  /** `null` for routes that return bytes rather than JSON. */
  response: R;
  auth: boolean;
}

const route = <
  M extends RouteDef['method'],
  P extends string,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType | null,
>(
  def: RouteDef<M, P, Q, B, R>,
) => def;

export const routes = {
  pair: route({
    method: 'POST',
    path: '/pair',
    query: NoQuery,
    body: PairRequest,
    response: PairResponse,
    auth: false,
  }),
  /**
   * The installed app pairs its own display: only from the same computer (loopback, no proxy
   * headers) and only when the server was started with LOCAL_PAIR=1.
   */
  pairLocal: route({
    method: 'POST',
    path: '/pair/local',
    query: z.object({ name: z.string().min(1).max(60).optional() }).strict(),
    body: NoBody,
    response: PairResponse,
    auth: false,
  }),
  updateCheck: route({
    method: 'GET',
    path: '/update',
    query: NoQuery,
    body: NoBody,
    response: UpdateCheckResponse,
    auth: true,
  }),
  bootstrap: route({
    method: 'GET',
    path: '/bootstrap',
    query: NoQuery,
    body: NoBody,
    response: BootstrapResponse,
    auth: true,
  }),
  calendar: route({
    method: 'GET',
    path: '/calendar',
    query: CalendarQuery,
    body: NoBody,
    response: CalendarResponse,
    auth: true,
  }),
  calendarQuick: route({
    method: 'POST',
    path: '/calendar/quick',
    query: NoQuery,
    body: QuickEventRequest,
    response: QuickEventResponse,
    auth: true,
  }),
  /** Change one event (one occurrence of a repeating Google event). Read-only calendars answer 403. */
  calendarEventPatch: route({
    method: 'PATCH',
    path: '/calendar/events/:id',
    query: NoQuery,
    body: EventPatchRequest,
    response: QuickEventResponse,
    auth: true,
  }),
  calendarEventDelete: route({
    method: 'DELETE',
    path: '/calendar/events/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  countdowns: route({
    method: 'GET',
    path: '/countdowns',
    query: NoQuery,
    body: NoBody,
    response: CountdownsResponse,
    auth: true,
  }),
  meals: route({
    method: 'GET',
    path: '/meals',
    query: MealsQuery,
    body: NoBody,
    response: MealsResponse,
    auth: true,
  }),
  weather: route({
    method: 'GET',
    path: '/weather',
    query: NoQuery,
    body: NoBody,
    response: WeatherResponse,
    auth: true,
  }),
  /** The same snapshot for another place (the weather sheet's place search and saved places). */
  weatherPlace: route({
    method: 'GET',
    path: '/weather/place',
    query: WeatherPlaceQuery,
    body: NoBody,
    response: WeatherResponse,
    auth: true,
  }),
  weatherSearch: route({
    method: 'GET',
    path: '/weather/search',
    query: WeatherSearchQuery,
    body: NoBody,
    response: WeatherSearchResponse,
    auth: true,
  }),
  /** Today's line about the weather, in the household's chosen personality. */
  weatherQuip: route({
    method: 'GET',
    path: '/weather/quip',
    query: NoQuery,
    body: NoBody,
    response: WeatherQuipResponse,
    auth: true,
  }),
  commute: route({
    method: 'GET',
    path: '/commute',
    query: NoQuery,
    body: NoBody,
    response: CommuteResponse,
    auth: true,
  }),
  photosNext: route({
    method: 'GET',
    path: '/photos/next',
    query: PhotosNextQuery,
    body: NoBody,
    response: PhotosNextResponse,
    auth: true,
  }),
  photo: route({
    method: 'GET',
    path: '/photos/:id',
    query: NoQuery,
    body: NoBody,
    response: null,
    auth: true,
  }),
  homeState: route({
    method: 'GET',
    path: '/home/state',
    query: NoQuery,
    body: NoBody,
    response: HomeStateResponse,
    auth: true,
  }),
  homeCall: route({
    method: 'POST',
    path: '/home/call',
    query: NoQuery,
    body: HomeCallRequest,
    response: HomeCallResponse,
    auth: true,
  }),
  homeAnnounce: route({
    method: 'POST',
    path: '/home/announce',
    query: NoQuery,
    body: AnnounceRequest,
    response: AnnounceResponse,
    auth: true,
  }),
  /** Latest still from an allowed camera (JPEG from Home Assistant, SVG in mock mode). */
  cameraSnapshot: route({
    method: 'GET',
    path: '/home/cameras/:id/snapshot',
    query: ImageQuery,
    body: NoBody,
    response: null,
    // Checked by the handler from `?key=`, since `<img>` cannot send the header.
    auth: false,
  }),
  /** Live view for an `<img>`: MJPEG from Home Assistant (an animated SVG in mock mode). */
  cameraStream: route({
    method: 'GET',
    path: '/home/cameras/:id/stream',
    query: ImageQuery,
    body: NoBody,
    response: null,
    auth: false,
  }),
  media: route({
    method: 'GET',
    path: '/media',
    query: NoQuery,
    body: NoBody,
    response: MediaResponse,
    auth: true,
  }),
  mediaCall: route({
    method: 'POST',
    path: '/media/call',
    query: NoQuery,
    body: MediaCallRequest,
    response: MediaCallResponse,
    auth: true,
  }),
  /* Home Assistant setup (WS C): the connection, discovery and the stored allow-list. */
  homeConnection: route({
    method: 'GET',
    path: '/home/connection',
    query: NoQuery,
    body: NoBody,
    response: HomeConnectionStatus,
    auth: true,
  }),
  /** Save the URL, token or on/off switch; the server reconnects at once, no restart. */
  homeConnectionPut: route({
    method: 'PUT',
    path: '/home/connection',
    query: NoQuery,
    body: HomeConnectionPatch,
    response: HomeConnectionStatus,
    auth: true,
  }),
  homeConnectionTest: route({
    method: 'POST',
    path: '/home/connection/test',
    query: NoQuery,
    body: HomeConnectionTestRequest,
    response: HomeTestResult,
    auth: true,
  }),
  /** Areas and entities Home Assistant has right now, for the room and device picker. */
  homeDiscover: route({
    method: 'GET',
    path: '/home/discover',
    query: NoQuery,
    body: NoBody,
    response: HomeDiscovery,
    auth: true,
  }),
  homeConfig: route({
    method: 'GET',
    path: '/home/config',
    query: NoQuery,
    body: NoBody,
    response: HomeConfig,
    auth: true,
  }),
  /** Replace the allow-list. Takes effect live; displays reload. */
  homeConfigPut: route({
    method: 'PUT',
    path: '/home/config',
    query: NoQuery,
    body: HomeConfig,
    response: HomeConfig,
    auth: true,
  }),
  /** Import a `home.yaml` (the whole file as text); replaces the stored allow-list. */
  homeConfigImportYaml: route({
    method: 'POST',
    path: '/home/config/import-yaml',
    query: NoQuery,
    body: HomeYaml,
    response: HomeConfig,
    auth: true,
  }),
  homeConfigExportYaml: route({
    method: 'GET',
    path: '/home/config/export-yaml',
    query: NoQuery,
    body: NoBody,
    response: HomeYaml,
    auth: true,
  }),
  /** Now-playing artwork for a media player; `MediaPlayer.artworkUrl` points here. */
  mediaArtwork: route({
    method: 'GET',
    path: '/media/:id/artwork',
    query: ImageQuery,
    body: NoBody,
    response: null,
    auth: false,
  }),
  lists: route({
    method: 'GET',
    path: '/lists',
    query: NoQuery,
    body: NoBody,
    response: ListsResponse,
    auth: true,
  }),
  listAddItem: route({
    method: 'POST',
    path: '/lists/:id/items',
    query: NoQuery,
    body: AddItemRequest,
    response: ItemResponse,
    auth: true,
  }),
  itemPatch: route({
    method: 'PATCH',
    path: '/items/:id',
    query: NoQuery,
    body: PatchItemRequest,
    response: ItemResponse,
    auth: true,
  }),
  itemDelete: route({
    method: 'DELETE',
    path: '/items/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  listCreate: route({
    method: 'POST',
    path: '/lists',
    query: NoQuery,
    body: CreateListRequest,
    response: ListResponse,
    auth: true,
  }),
  listsReorder: route({
    method: 'PUT',
    path: '/lists/order',
    query: NoQuery,
    body: ReorderListsRequest,
    response: ListsResponse,
    auth: true,
  }),
  listPatch: route({
    method: 'PATCH',
    path: '/lists/:id',
    query: NoQuery,
    body: PatchListRequest,
    response: ListResponse,
    auth: true,
  }),
  listDelete: route({
    method: 'DELETE',
    path: '/lists/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  chores: route({
    method: 'GET',
    path: '/chores',
    query: NoQuery,
    body: NoBody,
    response: ChoresResponse,
    auth: true,
  }),
  choreDone: route({
    method: 'POST',
    path: '/chores/:id/done',
    query: NoQuery,
    body: z.object({ personId: Id.optional() }).optional(),
    response: ChoreDoneResponse,
    auth: true,
  }),
  /** Take back the most recent completion of a chore in the current period (a mis-tap). */
  choreUndo: route({
    method: 'DELETE',
    path: '/chores/:id/done',
    query: NoQuery,
    body: NoBody,
    response: ChoreDoneResponse,
    auth: true,
  }),
  choreCreate: route({
    method: 'POST',
    path: '/chores',
    query: NoQuery,
    body: CreateChoreRequest,
    response: ChoreResponse,
    auth: true,
  }),
  /** Retire a chore. Stars already earned this week stay. */
  choreDelete: route({
    method: 'DELETE',
    path: '/chores/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  settings: route({
    method: 'GET',
    path: '/settings',
    query: NoQuery,
    body: NoBody,
    response: SettingsResponse,
    auth: true,
  }),
  settingsPut: route({
    method: 'PUT',
    path: '/settings',
    query: NoQuery,
    body: PutSettingsRequest,
    response: SettingsResponse,
    auth: true,
  }),
  devices: route({
    method: 'GET',
    path: '/devices',
    query: NoQuery,
    body: NoBody,
    response: DevicesResponse,
    auth: true,
  }),
  deviceRevoke: route({
    method: 'DELETE',
    path: '/devices/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  deviceRename: route({
    method: 'PATCH',
    path: '/devices/:id',
    query: NoQuery,
    body: RenameDeviceRequest,
    response: DeviceResponse,
    auth: true,
  }),
  pairingCode: route({
    method: 'GET',
    path: '/pairing-code',
    query: NoQuery,
    body: NoBody,
    response: PairingCodeResponse,
    auth: true,
  }),
  displayState: route({
    method: 'GET',
    path: '/display/state',
    query: NoQuery,
    body: NoBody,
    response: DisplayStateResponse,
    auth: true,
  }),
  displayReload: route({
    method: 'POST',
    path: '/display/reload',
    query: NoQuery,
    body: NoBody,
    response: DisplayReloadResponse,
    auth: true,
  }),
  health: route({
    method: 'GET',
    path: '/health',
    query: NoQuery,
    body: NoBody,
    response: HealthResponse,
    auth: false,
  }),

  /* ---- v2 workstream A: plugins, integrations, admin PIN, setup, backup, geocode ---- */
  plugins: route({
    method: 'GET',
    path: '/plugins',
    query: NoQuery,
    body: NoBody,
    response: PluginsResponse,
    auth: true,
  }),
  integrations: route({
    method: 'GET',
    path: '/integrations',
    query: NoQuery,
    body: NoBody,
    response: IntegrationsResponse,
    auth: true,
  }),
  integrationPut: route({
    method: 'PUT',
    path: '/integrations/:id',
    query: NoQuery,
    body: IntegrationPatch,
    response: IntegrationResponse,
    auth: true,
  }),
  integrationTest: route({
    method: 'POST',
    path: '/integrations/:id/test',
    query: NoQuery,
    body: TestRequest,
    response: TestResult,
    auth: true,
  }),
  integrationAuthorizeUrl: route({
    method: 'GET',
    path: '/integrations/:id/authorize-url',
    query: NoQuery,
    body: NoBody,
    response: AuthorizeUrlResponse,
    auth: true,
  }),
  integrationCallback: route({
    method: 'POST',
    path: '/integrations/:id/callback',
    query: NoQuery,
    body: OAuthCallbackRequest,
    response: IntegrationResponse,
    auth: true,
  }),
  healthDetails: route({
    method: 'GET',
    path: '/health/details',
    query: NoQuery,
    body: NoBody,
    response: HealthDetails,
    auth: true,
  }),
  /** No device key needed: on first run there is none yet. Changing a PIN needs the current one. */
  adminPin: route({
    method: 'POST',
    path: '/admin/pin',
    query: NoQuery,
    body: AdminPinRequest,
    response: AdminPinResponse,
    auth: false,
  }),
  /** No device key needed, so a fresh browser can learn whether this is the first run. */
  setupState: route({
    method: 'GET',
    path: '/setup/state',
    query: NoQuery,
    body: NoBody,
    response: SetupState,
    auth: false,
  }),
  setupStatePut: route({
    method: 'PUT',
    path: '/setup/state',
    query: NoQuery,
    body: PutSetupStateRequest,
    response: SetupState,
    auth: true,
  }),
  /** POST rather than GET so the passphrase never sits in a URL or a log. */
  settingsExport: route({
    method: 'POST',
    path: '/settings/export',
    query: NoQuery,
    body: ExportRequest,
    response: SettingsBundle,
    auth: true,
  }),
  settingsImport: route({
    method: 'POST',
    path: '/settings/import',
    query: NoQuery,
    body: ImportRequest,
    response: ImportResponse,
    auth: true,
  }),
  geocode: route({
    method: 'POST',
    path: '/geocode',
    query: NoQuery,
    body: GeocodeRequest,
    response: GeocodeResponse,
    auth: true,
  }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
/** Routes that answer JSON (everything but the byte routes). */
export type JsonRouteName = {
  [N in RouteName]: Routes[N]['response'] extends null ? never : N;
}[RouteName];

type Out<T> = T extends z.ZodType ? z.output<T> : never;
type In<T> = T extends z.ZodType ? z.input<T> : never;

export type ResponseOf<N extends RouteName> = Out<Routes[N]['response']>;
export type BodyOf<N extends RouteName> = In<Routes[N]['body']>;
export type QueryOf<N extends RouteName> = In<Routes[N]['query']>;

/** `{ id: string }` for `/lists/:id/items`, `{}` for paths without params. */
export type ParamsOf<N extends RouteName> = PathParams<Routes[N]['path']>;
type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in Param]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : Record<never, never>;

/** Fill `:params` in a route path. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}
