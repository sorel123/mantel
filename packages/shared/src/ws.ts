/**
 * The WebSocket contract: server to display at `/ws?key=<device key>`, one JSON message per
 * event, shaped `{ type, payload }`. The display never sends application messages; liveness
 * uses WebSocket ping frames.
 */
import { z } from 'zod';
import { HomeEntity, Id, IsoDateTime, MediaPlayer, Presence, WeatherSnapshot } from './models.js';

const event = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), payload });

export const CalendarChanged = event(
  'calendar.changed',
  z.object({ from: IsoDateTime, to: IsoDateTime }),
);
export const HomeStateEvent = event('home.state', z.object({ entity: HomeEntity }));
export const HomeDoorbell = event(
  'home.doorbell',
  z.object({
    cameraEntityId: Id,
    at: IsoDateTime,
    /** How long the live-view pop-over stays up. */
    durationSeconds: z.number().int().positive().default(30),
  }),
);
/** Who is home changed; the full presence list, as in `/home/state`. */
export const HomePresence = event('home.presence', z.object({ presence: z.array(Presence) }));
export const MediaStateEvent = event('media.state', z.object({ player: MediaPlayer }));
export const ListChanged = event('list.changed', z.object({ listId: Id }));
/** The chore chart changed (a tap, an undo, or a chore added or removed); the display refetches. */
export const ChoresChanged = event('chores.changed', z.object({}));
export const WeatherUpdated = event('weather.updated', z.object({ weather: WeatherSnapshot }));
export const DisplayReload = event('display.reload', z.object({}));
export const DisplayWake = event(
  'display.wake',
  z.object({ reason: z.enum(['presence', 'schedule', 'manual']) }),
);
export const DisplaySleep = event(
  'display.sleep',
  z.object({ reason: z.enum(['presence', 'schedule', 'manual']) }),
);

export const WsEvent = z.discriminatedUnion('type', [
  CalendarChanged,
  HomeStateEvent,
  HomeDoorbell,
  HomePresence,
  MediaStateEvent,
  ListChanged,
  ChoresChanged,
  WeatherUpdated,
  DisplayReload,
  DisplayWake,
  DisplaySleep,
]);
export type WsEvent = z.infer<typeof WsEvent>;
export type WsEventType = WsEvent['type'];
export type WsPayload<T extends WsEventType> = Extract<WsEvent, { type: T }>['payload'];
export type WsEventInput = z.input<typeof WsEvent>;

export const WS_EVENT_TYPES = WsEvent.options.map((o) => o.shape.type.value) as WsEventType[];

/** Parse a raw message; returns null for anything that is not a known event. */
export function parseWsEvent(raw: string): WsEvent | null {
  try {
    const result = WsEvent.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
