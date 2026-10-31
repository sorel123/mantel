/**
 * Layout presets and screen fit (workstream F).
 *
 * A preset is an arrangement of the same cards, not a new screen: the Today and Month screens
 * render their slots through `apps/display/src/app/layout`, so every preset shares the data
 * hooks. Fit says how the fixed-size panel meets a display's viewport.
 */
import { z } from 'zod';

import { Fit, Layout, MonthPreset, TodayPreset } from './models.js';

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
  if (parsed.success) return strip(parsed.data);
  // Keep the fields that are fine and drop the rest, so one bad value does not lose the others.
  const out: Partial<LayoutSettings> = {};
  const t = TodayPreset.safeParse(o.todayPreset);
  if (t.success) out.todayPreset = t.data;
  const m = MonthPreset.safeParse(o.monthPreset);
  if (m.success) out.monthPreset = m.data;
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
];

export const MONTH_PRESETS: ReadonlyArray<PresetInfo<MonthPreset>> = [
  { id: 'grid', name: 'Grid', description: 'Six weeks, a few events a day.' },
  { id: 'week', name: 'Week strip', description: 'Seven days with everything in them.' },
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
