/**
 * Layout presets and screen fit (workstream F).
 *
 * A preset is an arrangement of the same cards, not a new screen: the Today and Month screens
 * render their slots through `apps/display/src/app/layout`, so every preset shares the data
 * hooks. Fit says how the fixed-size panel meets a display's viewport.
 */
import { z } from 'zod';

import {
  DEFAULT_TODAY_CARDS,
  Fit,
  Layout,
  MonthDensity,
  MonthPreset,
  SavedTodayLayout,
  TODAY_CARD_STEP,
  TODAY_GRID_COLS,
  TODAY_GRID_ROWS,
  TodayCard,
  type TodayCardKind,
  TodayPreset,
  TodayRow,
} from './models.js';

/** The layout settings object (`Layout` in models.ts; this is the name the display uses). */
export const LayoutSettings = Layout;
export type LayoutSettings = Layout;

/** The slider's range for the `scale` fit; the schema allows a wider band for kiosk addresses. */
export const SCALE_MIN = 0.9;
export const SCALE_MAX = 1.3;
export const SCALE_STEP = 0.05;

export const DEFAULT_LAYOUT: LayoutSettings = {
  todayPreset: 'agenda',
  monthPreset: 'grid',
  monthDensity: 'roomy',
  todayRows: ['tonight', 'week'],
  todayCards: DEFAULT_TODAY_CARDS,
  savedToday: [],
  fit: 'fit',
  scale: 1,
};

/**
 * What one display may override: the same fields, each optional. Comes from the display's
 * own address (`?today=weather&month=week&fit=fill&scale=1.1`) and, once the server keeps
 * per-device settings, from its `Device` record.
 */
export const LayoutOverride = z.object({
  todayPreset: TodayPreset.optional(),
  monthPreset: MonthPreset.optional(),
  monthDensity: MonthDensity.optional(),
  todayRows: Layout.shape.todayRows.unwrap().optional(),
  todayCards: Layout.shape.todayCards.unwrap().optional(),
  savedToday: Layout.shape.savedToday.unwrap().optional(),
  fit: Fit.optional(),
  scale: Layout.shape.scale.unwrap().optional(),
});
export type LayoutOverride = z.infer<typeof LayoutOverride>;

/** The household setting with each override laid over it, later ones winning. Unknown values are ignored. */
export function resolveLayout(
  base: Partial<LayoutSettings> | null | undefined,
  ...overrides: Array<Partial<LayoutSettings> | null | undefined>
): LayoutSettings {
  let out: LayoutSettings = { ...DEFAULT_LAYOUT, ...clean(base) };
  for (const o of overrides) out = { ...out, ...clean(o) };
  return out;
}

function clean(o: Partial<LayoutSettings> | null | undefined): Partial<LayoutSettings> {
  if (!o) return {};
  const parsed = LayoutOverride.safeParse(o);
  if (parsed.success) {
    const out = strip(parsed.data);
    if (out.todayCards) out.todayCards = tidyCards(out.todayCards);
    return out;
  }
  // Keep the fields that are fine and drop the rest, so one bad value does not lose the others.
  const out: Partial<LayoutSettings> = {};
  const t = TodayPreset.safeParse(o.todayPreset);
  if (t.success) out.todayPreset = t.data;
  const m = MonthPreset.safeParse(o.monthPreset);
  if (m.success) out.monthPreset = m.data;
  const d = MonthDensity.safeParse(o.monthDensity);
  if (d.success) out.monthDensity = d.data;
  if (Array.isArray(o.todayRows)) {
    const rows = o.todayRows.filter((r) => TodayRow.safeParse(r).success);
    out.todayRows = [...new Set(rows)].slice(0, 5);
  }
  if (Array.isArray(o.todayCards)) {
    out.todayCards = tidyCards(
      o.todayCards.flatMap((c) => {
        const p = TodayCard.safeParse(c);
        return p.success ? [p.data] : [];
      }),
    );
  }
  if (Array.isArray(o.savedToday)) {
    out.savedToday = o.savedToday.flatMap((l) => {
      const p = SavedTodayLayout.safeParse(l);
      return p.success ? [{ ...p.data, cards: tidyCards(p.data.cards) }] : [];
    });
  }
  const f = Fit.safeParse(o.fit);
  if (f.success) out.fit = f.data;
  const s = LayoutOverride.shape.scale.safeParse(o.scale);
  if (s.success && s.data !== undefined) out.scale = s.data;
  return out;
}

const strip = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** A layout override from a display's URL query (`?today=…&month=…&fit=…&scale=…`). */
export function layoutFromSearch(search: string): LayoutOverride {
  const q = new URLSearchParams(search);
  const out: Record<string, unknown> = {};
  if (q.has('today')) out.todayPreset = q.get('today');
  if (q.has('month')) out.monthPreset = q.get('month');
  if (q.has('density')) out.monthDensity = q.get('density');
  if (q.has('rows')) out.todayRows = q.get('rows')!.split(',').filter(Boolean);
  if (q.has('cards')) out.todayCards = cardsFromParam(q.get('cards')!);
  if (q.has('fit')) out.fit = q.get('fit');
  if (q.has('scale')) {
    const raw = q.get('scale')!.trim().replace(/%$/, '');
    const n = Number(raw);
    // Accept "1.2" or "120".
    if (Number.isFinite(n)) out.scale = n > 3 ? n / 100 : n;
  }
  return clean(out as Partial<LayoutSettings>);
}

/* ---------- names and descriptions for pickers ---------- */

export interface PresetInfo<T extends string> {
  id: T;
  name: string;
  description: string;
}

export const TODAY_PRESETS: ReadonlyArray<PresetInfo<TodayPreset>> = [
  { id: 'agenda', name: 'Agenda', description: 'Date, weather and grocery beside the day.' },
  {
    id: 'weather',
    name: 'Weather focus',
    description: 'Big forecast with the week ahead, a short agenda.',
  },
  { id: 'family', name: 'Family board', description: 'A column for each person.' },
  {
    id: 'photo',
    name: 'Photo and agenda',
    description: 'The album on the left, the day on the right.',
  },
  { id: 'poster', name: 'Poster', description: 'A flyer: huge date, the day as a bill.' },
  { id: 'custom', name: 'Your own', description: 'Move, resize, add and remove the cards.' },
];

export const MONTH_PRESETS: ReadonlyArray<PresetInfo<MonthPreset>> = [
  { id: 'grid', name: 'Grid', description: 'The whole month, a few events a day.' },
  { id: 'week', name: 'Week strip', description: 'Seven days with everything in them.' },
];

export const MONTH_DENSITIES: ReadonlyArray<PresetInfo<MonthDensity>> = [
  { id: 'roomy', name: 'Roomy', description: 'Bigger type, fewer events a day.' },
  { id: 'compact', name: 'Compact', description: 'Smaller type, room for more events.' },
  { id: 'dense', name: 'Dense', description: 'Smallest type, the most events a day.' },
];

export const TODAY_ROWS: ReadonlyArray<PresetInfo<TodayRow>> = [
  { id: 'tonight', name: 'Tonight', description: "Tonight's dinner from the meal plan." },
  { id: 'week', name: 'Next three days', description: 'Tomorrow and the two days after.' },
  { id: 'countdowns', name: 'Countdowns', description: 'Days until starred events.' },
  { id: 'list', name: 'List', description: 'The list pinned to Today.' },
  { id: 'photo', name: 'Photo', description: 'The photo slideshow.' },
];

export const FIT_MODES: ReadonlyArray<PresetInfo<Fit>> = [
  { id: 'fit', name: 'Fit', description: 'Keep the design; bars on displays with another shape.' },
  {
    id: 'fill',
    name: 'Fill',
    description: 'Stretch to the edges; cards grow, type stays the same.',
  },
  { id: 'scale', name: 'Scale', description: 'Fill, then make everything bigger or smaller.' },
];

/* ---------- the Custom layout's cards ---------- */

export const TODAY_CARDS: ReadonlyArray<PresetInfo<TodayCardKind>> = [
  { id: 'date', name: 'Date', description: 'The day and date; one line when short.' },
  { id: 'weather', name: 'Weather', description: 'Now, the next hours and the quip.' },
  { id: 'forecast', name: 'Next 7 days', description: "The week's highs, lows and rain." },
  { id: 'agenda', name: 'Agenda', description: "Today's events, with the Day/Week switch." },
  { id: 'week', name: 'Week', description: 'Seven days with everything in them.' },
  { id: 'photo', name: 'Photos', description: 'The photo slideshow.' },
  { id: 'list', name: 'List', description: 'The list pinned to Today.' },
  { id: 'countdowns', name: 'Countdowns', description: 'Days until starred events.' },
  { id: 'tonight', name: 'Tonight', description: "Tonight's dinner from the meal plan." },
];

/** Whether two cards share a cell. */
export const cardsOverlap = (a: TodayCard, b: TodayCard): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether a card sits inside the grid. */
export const cardInGrid = (c: TodayCard): boolean =>
  c.x >= 0 && c.y >= 0 && c.x + c.w <= TODAY_GRID_COLS && c.y + c.h <= TODAY_GRID_ROWS;

/** Whether `card` can go where it says among `others` (itself excluded by id). */
export const cardFits = (card: TodayCard, others: readonly TodayCard[]): boolean =>
  cardInGrid(card) && others.every((o) => o.id === card.id || !cardsOverlap(card, o));

/**
 * Cards made safe to draw: sizes clamped into the grid, then each card that would overlap one
 * kept before it dropped, and ids made unique.
 */
export function tidyCards(cards: readonly TodayCard[]): TodayCard[] {
  const out: TodayCard[] = [];
  const ids = new Set<string>();
  for (const c of cards) {
    const w = Math.min(c.w, TODAY_GRID_COLS - c.x);
    const h = Math.min(c.h, TODAY_GRID_ROWS - c.y);
    let id = c.id;
    for (let n = 2; ids.has(id); n++) id = `${c.id}-${n}`;
    const card = { ...c, id, w, h };
    if (w < 1 || h < 1 || out.some((o) => cardsOverlap(o, card))) continue;
    ids.add(id);
    out.push(card);
  }
  return out;
}

/** The first free top-left spot for a w by h card, scanning rows then columns, or null. */
export function findSpot(
  cards: readonly TodayCard[],
  w: number,
  h: number,
): { x: number; y: number } | null {
  for (let y = 0; y + h <= TODAY_GRID_ROWS; y += TODAY_CARD_STEP)
    for (let x = 0; x + w <= TODAY_GRID_COLS; x += TODAY_CARD_STEP) {
      const probe = { id: '\u0000', kind: 'date' as const, x, y, w, h };
      if (cards.every((c) => !cardsOverlap(c, probe))) return { x, y };
    }
  return null;
}

/**
 * The smallest each card may get in the editor, [w, h] in cells: below this it stops being
 * readable on the wall.
 */
export const CARD_MIN: Readonly<Record<TodayCardKind, readonly [number, number]>> = {
  date: [2, 1],
  weather: [2.5, 1],
  forecast: [4.5, 1.5],
  agenda: [3, 3],
  week: [6, 3],
  photo: [1.5, 1.5],
  list: [2, 1.5],
  countdowns: [2.5, 1],
  tonight: [2.5, 1],
};

/**
 * The size each card is drawn for, [w, h] in cells. A card smaller than this draws its content
 * a little smaller to fit (see cardZoom), down to CARD_ZOOM_MIN. Cards that change shape when
 * small (the date, the weather) give the size of each shape.
 */
const CARD_COMFORT: Readonly<Record<TodayCardKind, readonly [number, number] | null>> = {
  date: null,
  weather: [4, 4],
  forecast: [6, 2],
  agenda: [5.5, 6],
  week: [8, 4],
  photo: null,
  list: [3, 2.5],
  countdowns: [4, 1],
  tonight: [4, 1],
};
export const CARD_ZOOM_MIN = 0.75;

/** How much to shrink a card's content (1 = not at all) so it fits the card. */
export function cardZoom(card: Pick<TodayCard, 'kind' | 'w' | 'h'>, shape?: 'line'): number {
  const comfort = shape === 'line' ? ([4, 1] as const) : CARD_COMFORT[card.kind];
  if (!comfort) return 1;
  const k = Math.min(card.w / comfort[0], card.h / comfort[1], 1);
  return Math.round(Math.max(CARD_ZOOM_MIN, k) * 100) / 100;
}

/** A size written for people: 4½ for 4.5. */
export const cardSize = (n: number): string =>
  Number.isInteger(n) ? String(n) : `${Math.floor(n) || ''}½`;

/** Starting points for the editor, to customize and save as your own. */
export interface CardStarter {
  id: string;
  name: string;
  cards: TodayCard[];
}
const card = (kind: TodayCardKind, x: number, y: number, w: number, h: number): TodayCard => ({
  id: kind,
  kind,
  x,
  y,
  w,
  h,
});
export const CARD_STARTERS: readonly CardStarter[] = [
  { id: 'agenda', name: 'Agenda', cards: DEFAULT_TODAY_CARDS },
  {
    id: 'weather',
    name: 'Weather focus',
    cards: [
      card('date', 0, 0, 7, 1),
      card('weather', 0, 1, 7, 4),
      card('forecast', 0, 5, 7, 3),
      card('agenda', 7, 0, 5, 8),
    ],
  },
  {
    id: 'photo',
    name: 'Photo and agenda',
    cards: [card('photo', 0, 0, 7, 8), card('agenda', 7, 0, 5, 8)],
  },
  {
    id: 'week',
    name: 'Week at a glance',
    cards: [
      card('date', 0, 0, 4, 1.5),
      card('weather', 4, 0, 4, 1.5),
      card('countdowns', 8, 0, 4, 1.5),
      card('week', 0, 1.5, 12, 6.5),
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    cards: [
      card('date', 0, 0, 4, 1.5),
      card('tonight', 0, 1.5, 4, 1),
      card('list', 0, 2.5, 4, 5.5),
      card('agenda', 4, 0, 5, 8),
      card('weather', 9, 0, 3, 4),
      card('photo', 9, 4, 3, 4),
    ],
  },
  {
    id: 'frame',
    name: 'Photo frame',
    cards: [
      card('photo', 0, 0, 12, 6.5),
      card('date', 0, 6.5, 4, 1.5),
      card('weather', 4, 6.5, 4, 1.5),
      card('tonight', 8, 6.5, 4, 1.5),
    ],
  },
  {
    id: 'everything',
    name: 'A bit of everything',
    cards: [
      card('date', 0, 0, 3.5, 1.5),
      card('weather', 0, 1.5, 3.5, 6.5),
      card('agenda', 3.5, 0, 5, 8),
      card('photo', 8.5, 0, 3.5, 3),
      card('tonight', 8.5, 3, 3.5, 1),
      card('countdowns', 8.5, 4, 3.5, 1),
      card('list', 8.5, 5, 3.5, 3),
    ],
  },
];

/**
 * Cards in a display address: `agenda:4.0.8.8,date:0.0.4.2` (kind:x.y.w.h). With a half cell
 * anywhere the numbers are joined by `_` instead: `date:0_0_3.5_1`.
 */
export const cardsToParam = (cards: readonly TodayCard[]): string =>
  cards
    .map((c) => {
      const n = [c.x, c.y, c.w, c.h];
      return `${c.kind}:${n.join(n.every(Number.isInteger) ? '.' : '_')}`;
    })
    .join(',');

export function cardsFromParam(param: string): TodayCard[] {
  const out: TodayCard[] = [];
  for (const part of param.split(',')) {
    const [kind, pos = ''] = part.split(':');
    const [x, y, w, h] = pos.split(pos.includes('_') ? '_' : '.').map(Number);
    const card = TodayCard.safeParse({ id: `${kind}-${out.length}`, kind, x, y, w, h });
    if (card.success) out.push(card.data);
  }
  return tidyCards(out);
}
