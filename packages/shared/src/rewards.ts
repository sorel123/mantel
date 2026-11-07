/**
 * v3 workstream R: chores with a time of day and an icon, routines, a star ledger that never
 * resets, and rewards to spend stars on.
 *
 * Balance is the sum of a person's ledger. The weekly tally on `GET /chores` stays for the
 * chart. Completing a chore adds a ledger entry; taking the tap back removes it. Redeeming a
 * reward and adjusting by hand both need the admin PIN.
 *
 * This file only imports zod (models.ts imports it for `ChoreTimeOfDay`, so it must not import
 * models.ts back). Routes are merged into the route table in api.ts.
 */
import { z } from 'zod';
import type { RouteDef } from './api.js';

const Id = z.string().min(1);
const IsoDateTime = z.iso.datetime({ offset: true });
const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();
/** The admin PIN, as `POST /pair` takes it. */
const Pin = z.string().regex(/^\d{4,8}$/, 'the PIN is 4 to 8 digits');

/* ---------- time of day ---------- */

export const ChoreTimeOfDay = z.enum(['morning', 'afternoon', 'evening', 'any']);
export type ChoreTimeOfDay = z.infer<typeof ChoreTimeOfDay>;
/** A time of day that is a part of the day (not `any`). */
export type DayPart = Exclude<ChoreTimeOfDay, 'any'>;
export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening'];
export const TIME_OF_DAY_LABEL: Record<ChoreTimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  any: 'Any time',
};
/** Morning until 11:00, afternoon until 17:00, evening after. */
export const MORNING_ENDS = 11;
export const EVENING_STARTS = 17;

/** The part of the day `at` falls in, by the display's local clock. */
export function dayPartAt(at: Date): DayPart {
  const h = at.getHours();
  if (h < MORNING_ENDS) return 'morning';
  if (h < EVENING_STARTS) return 'afternoon';
  return 'evening';
}

/**
 * The icons a chore, routine or reward can show. The display bundles one SVG per key
 * (`screens/lists/icons.tsx`); an unknown key falls back to a star, so the list can grow.
 */
export const CHORE_ICONS = [
  'toothbrush',
  'bed',
  'backpack',
  'dog',
  'cat',
  'fish',
  'dishes',
  'trash',
  'recycle',
  'book',
  'shower',
  'bath',
  'shirt',
  'socks',
  'shoes',
  'laundry',
  'broom',
  'vacuum',
  'sponge',
  'plant',
  'table',
  'fork',
  'apple',
  'water',
  'pill',
  'hairbrush',
  'sun',
  'moon',
  'clock',
  'homework',
  'pencil',
  'music',
  'ball',
  'bike',
  'toys',
  'car',
  'phone',
  'tv',
  'gift',
  'icecream',
  'pizza',
  'cookie',
  'movie',
  'game',
  'park',
  'heart',
  'star',
  'trophy',
  'coin',
  'crown',
] as const;
export type ChoreIconKey = (typeof CHORE_ICONS)[number];
export const ChoreIcon = z.string().min(1).max(40);

/* ---------- routines ---------- */

/** A named group of chores done together (Morning, Bedtime), shown as one big checklist. */
export const Routine = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  /** Who follows it. Its chores each still belong to one person. */
  personIds: z.array(Id),
  timeOfDay: ChoreTimeOfDay,
  icon: ChoreIcon.default('sun'),
});
export type Routine = z.infer<typeof Routine>;

export const RoutineInput = Routine.omit({ id: true });
export const RoutinePatch = RoutineInput.partial().refine((r) => Object.keys(r).length > 0, {
  message: 'nothing to change',
});

/* ---------- stars ---------- */

export const StarReason = z.enum(['chore', 'bonus', 'redeem', 'adjust']);
export type StarReason = z.infer<typeof StarReason>;

export const StarLedgerEntry = z.object({
  id: Id,
  personId: Id,
  /** Stars added (positive) or spent (negative). */
  delta: z.number().int(),
  reason: StarReason,
  /** The completion (`completion:<n>`) or reward id the entry is for. */
  refId: z.string().optional(),
  /** What it was for, in words: the chore or reward title, or the reason typed for an adjustment. */
  note: z.string().max(120).optional(),
  at: IsoDateTime,
});
export type StarLedgerEntry = z.infer<typeof StarLedgerEntry>;

export const StarBalance = z.object({
  personId: Id,
  /** Stars banked: the sum of the ledger. Never resets. */
  stars: z.number().int(),
  /** Stars earned from chores this week, as on the chart. */
  week: z.number().int().nonnegative(),
});
export type StarBalance = z.infer<typeof StarBalance>;

/* ---------- rewards ---------- */

export const Reward = z.object({
  id: Id,
  title: z.string().trim().min(1).max(60),
  cost: z.number().int().min(1).max(1000),
  icon: ChoreIcon.default('gift'),
  /** Who can redeem it; empty means everyone. */
  personIds: z.array(Id).default([]),
  active: z.boolean().default(true),
});
export type Reward = z.infer<typeof Reward>;

export const RewardInput = Reward.omit({ id: true });
export const RewardPatch = RewardInput.partial().refine((r) => Object.keys(r).length > 0, {
  message: 'nothing to change',
});

/* ---------- settings ---------- */

/** `settings.chores`: celebrations on the wall. */
export const ChoreSettings = z.object({
  /** People who see no particle burst or banner (teenagers). */
  celebrationsOff: z.array(Id).default([]),
  /** A short chime with each celebration. Off by default: celebrations are silent. */
  chime: z.boolean().default(false),
});
export type ChoreSettings = z.infer<typeof ChoreSettings>;
export const DEFAULT_CHORE_SETTINGS: ChoreSettings = { celebrationsOff: [], chime: false };

/* ---------- requests and responses ---------- */

export const StarsBalanceResponse = z.object({
  balances: z.array(StarBalance),
  /** The household's celebration settings, so the wall needs no second call. */
  celebrations: ChoreSettings,
});
export const StarsLedgerQuery = z.object({
  personId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export const StarsLedgerResponse = z.object({ entries: z.array(StarLedgerEntry) });
export const StarsAdjustRequest = z.object({
  personId: Id,
  delta: z
    .number()
    .int()
    .min(-500)
    .max(500)
    .refine((n) => n !== 0, { message: 'give a number of stars other than 0' }),
  /** `bonus` for a reward for good behaviour, `adjust` for a correction. */
  reason: z.enum(['bonus', 'adjust']).default('adjust'),
  note: z.string().trim().max(120).optional(),
  pin: Pin,
});
export const StarEntryResponse = z.object({ entry: StarLedgerEntry, balance: StarBalance });

export const RewardsResponse = z.object({ rewards: z.array(Reward) });
export const RewardResponse = z.object({ reward: Reward });
export const RedeemRequest = z.object({ personId: Id, pin: Pin });

export const RoutinesResponse = z.object({ routines: z.array(Routine) });
export const RoutineResponse = z.object({ routine: Routine });

/** Change a chore in place: title, who, how often, stars, time of day, icon or routine. */
export const ChorePatchRequest = z
  .object({
    title: z.string().trim().min(1).max(80),
    personId: Id,
    cadence: z.enum(['daily', 'weekly']),
    stars: z.number().int().min(1).max(5),
    target: z.number().int().min(1).max(7),
    timeOfDay: ChoreTimeOfDay,
    icon: ChoreIcon.nullable(),
    routineId: Id.nullable(),
  })
  .partial()
  .refine((r) => Object.keys(r).length > 0, { message: 'nothing to change' });

/* ---------- WebSocket ---------- */

/** Someone spent stars on a reward (C's Web Push sends it to phones). */
export const RewardsRedeemed = z.object({
  type: z.literal('rewards.redeemed'),
  payload: z.object({
    personId: Id,
    rewardId: Id,
    title: z.string(),
    cost: z.number().int(),
    at: IsoDateTime,
  }),
});

/* ---------- routes (merged into `routes` in api.ts) ---------- */

const def = <
  M extends RouteDef['method'],
  P extends string,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  d: RouteDef<M, P, Q, B, R>,
) => d;

export const rewardRoutes = {
  starsBalance: def({
    method: 'GET',
    path: '/stars/balance',
    query: NoQuery,
    body: NoBody,
    response: StarsBalanceResponse,
    auth: true,
  }),
  starsLedger: def({
    method: 'GET',
    path: '/stars/ledger',
    query: StarsLedgerQuery,
    body: NoBody,
    response: StarsLedgerResponse,
    auth: true,
  }),
  /** Add or take away stars by hand. Needs the admin PIN. */
  starsAdjust: def({
    method: 'POST',
    path: '/stars/adjust',
    query: NoQuery,
    body: StarsAdjustRequest,
    response: StarEntryResponse,
    auth: true,
  }),
  rewards: def({
    method: 'GET',
    path: '/rewards',
    query: NoQuery,
    body: NoBody,
    response: RewardsResponse,
    auth: true,
  }),
  rewardCreate: def({
    method: 'POST',
    path: '/rewards',
    query: NoQuery,
    body: RewardInput,
    response: RewardResponse,
    auth: true,
  }),
  rewardPatch: def({
    method: 'PATCH',
    path: '/rewards/:id',
    query: NoQuery,
    body: RewardPatch,
    response: RewardResponse,
    auth: true,
  }),
  rewardDelete: def({
    method: 'DELETE',
    path: '/rewards/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  /** Spend stars on a reward. Needs the admin PIN; emits `rewards.redeemed`. */
  rewardRedeem: def({
    method: 'POST',
    path: '/rewards/:id/redeem',
    query: NoQuery,
    body: RedeemRequest,
    response: StarEntryResponse,
    auth: true,
  }),
  routines: def({
    method: 'GET',
    path: '/routines',
    query: NoQuery,
    body: NoBody,
    response: RoutinesResponse,
    auth: true,
  }),
  routineCreate: def({
    method: 'POST',
    path: '/routines',
    query: NoQuery,
    body: RoutineInput,
    response: RoutineResponse,
    auth: true,
  }),
  routinePatch: def({
    method: 'PATCH',
    path: '/routines/:id',
    query: NoQuery,
    body: RoutinePatch,
    response: RoutineResponse,
    auth: true,
  }),
  /** Delete a routine. Its chores stay, out of any routine. */
  routineDelete: def({
    method: 'DELETE',
    path: '/routines/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
} as const;
