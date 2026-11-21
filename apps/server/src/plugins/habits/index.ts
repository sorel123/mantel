/**
 * Habits and plants (v4 G): recurring things that are not chores. "Water the plants every 5
 * days", "Vitamins daily for Jay". The card sorts by what is due, shows when each was last
 * done, and Done restarts the count. Last-done times live in kv.
 */
import {
  type ConfigValue,
  type IntegrationConfig,
  type PluginActionResponse,
  type PluginBlocksInput,
  type TestResult,
} from '@mantel/shared';
import { addDays, startOfDay } from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import { cap, dayDiff, dayWord, entries, joinAnd, plural, type PackDeps } from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface Habit {
  key: string;
  name: string;
  every: number;
  person: string | null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  ten: 10,
  other: 2,
};

/** "Water the plants every 5 days", "Vitamins daily for Jay", "Filter every 3 months", "Bins weekly". */
export function parseHabit(text: string): Habit | null {
  let rest = text.trim();
  let person: string | null = null;
  const forM = /\s+for\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)?)\s*$/.exec(rest);
  if (forM) {
    person = forM[1]!;
    rest = rest.slice(0, forM.index);
  }
  const pats: Array<[RegExp, (m: RegExpExecArray) => number]> = [
    [/\s+(?:every\s+day|daily)$/i, () => 1],
    [/\s+(?:every\s+week|weekly)$/i, () => 7],
    [/\s+(?:every\s+month|monthly)$/i, () => 30],
    [/\s+every\s+(\d+|[a-z]+)\s+days?$/i, (m) => Number(m[1]) || WORDS[m[1]!.toLowerCase()] || NaN],
    [
      /\s+every\s+(\d+|[a-z]+)\s+weeks?$/i,
      (m) => 7 * (Number(m[1]) || WORDS[m[1]!.toLowerCase()] || NaN),
    ],
    [
      /\s+every\s+(\d+|[a-z]+)\s+months?$/i,
      (m) => 30 * (Number(m[1]) || WORDS[m[1]!.toLowerCase()] || NaN),
    ],
  ];
  for (const [re, f] of pats) {
    const m = re.exec(rest);
    if (!m) continue;
    const every = f(m);
    const name = cap(rest.slice(0, m.index).trim());
    if (!name || !Number.isFinite(every) || every < 1) return null;
    return { key: slug(`${name} ${person ?? ''}`), name, every, person };
  }
  return null;
}

export interface Done {
  at: string;
  by?: string;
}

/** Days until due: negative is overdue, 0 is today; null for never done. */
export function dueIn(h: Habit, done: Done | undefined, now: Date): number | null {
  if (!done) return null;
  return dayDiff(now, addDays(startOfDay(new Date(done.at)), h.every));
}

const ICON = (h: Habit) =>
  /plant|water|garden|herb|lawn|seed/i.test(h.name)
    ? 'sprout'
    : /vitamin|pill|med|floss/i.test(h.name)
      ? 'pill'
      : 'sprout';

export const MOCK_HABITS =
  'Water the plants every 5 days; Vitamins daily for Jay; Furnace filter every 90 days; Feed the sourdough every 2 days';

export function habitsCard(
  list: Habit[],
  done: Record<string, Done>,
  now: Date,
): PluginBlocksInput {
  const items = list
    .map((h) => ({ h, d: done[h.key], due: dueIn(h, done[h.key], now) }))
    .sort((a, b) => (a.due ?? -1e9) - (b.due ?? -1e9));
  const dueCount = items.filter((x) => x.due === null || x.due <= 0).length;
  return {
    title: dueCount
      ? `${plural(dueCount, 'thing')} due`
      : list.length
        ? 'All caught up'
        : 'Habits and plants',
    icon: 'sprout',
    lines: items.map(({ h, d, due }) => {
      const doneToday = d && dayDiff(new Date(d.at), now) === 0;
      const word = d ? dayWord(new Date(d.at), now) : '';
      const last = d
        ? `last done ${/^(Today|Yesterday)$/.test(word) ? word.toLowerCase() : word}`
        : '';
      return {
        id: h.key,
        icon: doneToday ? 'check' : ICON(h),
        text: h.person ? `${h.name} · ${h.person}` : h.name,
        sub: doneToday
          ? `Done today${h.every > 1 ? ` · next in ${plural(h.every, 'day')}` : ''}`
          : due === null
            ? 'Not done yet'
            : due < 0
              ? `${plural(-due, 'day')} overdue · ${last}`
              : due === 0
                ? `Due today · ${last}`
                : `In ${plural(due, 'day')}`,
        tone: doneToday
          ? ('good' as const)
          : due === null || due <= 0
            ? ('warn' as const)
            : 'normal',
        actions: doneToday
          ? [{ name: 'undo', label: 'Undo', args: { key: h.key } }]
          : due === null || due <= 1
            ? [{ name: 'done', label: 'Done', args: { key: h.key }, tone: 'primary' as const }]
            : [],
      };
    }),
    empty: 'Add habits in Settings, Plugins, Habits and plants.',
  };
}

export function habitsPlugin(deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  const now = () => ctx?.now() ?? new Date();
  const KV = 'plugin.habits';
  const list = () =>
    entries(!config.habits && deps.mock ? MOCK_HABITS : config.habits).flatMap(
      (t) => parseHabit(t) ?? [],
    );
  let memory: Record<string, Done> = {};
  const done = (): Record<string, Done> => {
    const stored = ctx ? kvGet<Record<string, Done>>(ctx.db, KV) : memory;
    if (stored) return stored;
    if (!deps.mock) return {};
    // Mock mode: a believable history so the card has every state.
    const ago = (n: number) => addDays(now(), -n).toISOString();
    return {
      'water-the-plants': { at: ago(5) },
      'vitamins-jay': { at: now().toISOString() },
      'furnace-filter': { at: ago(56) },
      'feed-the-sourdough': { at: ago(3) },
    };
  };
  const save = (d: Record<string, Done>) => {
    memory = d;
    if (ctx) kvSet(ctx.db, KV, d);
  };
  const changed = () => ctx?.emit({ type: 'plugin.changed', payload: { id: 'habits' } });

  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply(next) {
      config = next;
      changed();
    },
    async test(next): Promise<TestResult> {
      const parts = entries(next.habits);
      const bad = parts.filter((t) => !parseHabit(t));
      if (bad.length)
        return {
          ok: false,
          message: `I could not read “${bad[0]}”. End it with daily, weekly or every 5 days.`,
        };
      if (!parts.length)
        return { ok: false, message: 'Add a habit, like Water the plants every 5 days.' };
      const habits = parts.map((t) => parseHabit(t)!);
      return {
        ok: true,
        message: `${joinAnd(habits.map((h) => `${h.name.toLowerCase()} every ${h.every === 1 ? 'day' : plural(h.every, 'day')}`))}.`,
      };
    },
    status(): PluginStatusFields {
      const l = list();
      if (!l.length)
        return { state: 'not_set_up', summary: 'No habits yet', lastOkAt: null, lastError: null };
      const d = done();
      const due = l.filter((h) => (dueIn(h, d[h.key], now()) ?? -1) <= 0).length;
      return {
        state: 'connected',
        summary: `${plural(l.length, 'habit')}, ${due} due today`,
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      if (name === 'card') return habitsCard(list(), done(), now());
      if (name === 'ambient') {
        const d = done();
        const due = list().filter((h) => {
          const n = dueIn(h, d[h.key], now());
          return n !== null && n <= 0;
        });
        if (!due.length) return null;
        return {
          title:
            due.length === 1
              ? `${due[0]!.name} today`
              : `Due: ${joinAnd(due.map((h) => h.name.toLowerCase()))}`,
          icon: 'sprout',
          lines: [],
        };
      }
      return undefined;
    },
    async action(name, args: Record<string, ConfigValue>): Promise<PluginActionResponse> {
      const h = list().find((x) => x.key === args.key);
      if (!h) throw new HttpError('not_found', 'That habit is no longer on the list.');
      const d = { ...done() };
      if (name === 'done') {
        const prev = d[h.key];
        d[h.key] = {
          at: now().toISOString(),
          ...(typeof args.by === 'string' ? { by: args.by } : {}),
        };
        // Keep the one before, so Undo can put it back.
        if (prev) d[`${h.key}#prev`] = prev;
        save(d);
        changed();
        return { ok: true, message: `${h.name}: done. Next in ${plural(h.every, 'day')}.` };
      }
      if (name === 'undo') {
        const prev = d[`${h.key}#prev`];
        if (prev) d[h.key] = prev;
        else delete d[h.key];
        delete d[`${h.key}#prev`];
        save(d);
        changed();
        return { ok: true, message: `${h.name}: undone.` };
      }
      throw new HttpError('not_found', `Habits can’t ${name}.`);
    },
  };
}
