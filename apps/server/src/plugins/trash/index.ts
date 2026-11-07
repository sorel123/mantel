/**
 * Trash and recycling day: the first plugin that draws on the display without screen code. It
 * answers `blocks('card')` for its Today card and `blocks('ambient')` for its Ambient line; the
 * display renders both with its one plugin-blocks component. See `docs/plugins.md`.
 */
import {
  addDays,
  startOfDay,
  toIsoDate,
  type IntegrationConfig,
  type PluginBlocksInput,
  type TestResult,
} from '@mantel/shared';
import type { ProviderContext } from '../../providers/types.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';
import {
  STREAMS,
  momentAt,
  pickups,
  scheduleFrom,
  streamNames,
  type Pickup,
  type TrashSchedule,
} from './schedule.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Tomorrow", "Thursday", "Thu, Nov 20" for further out. */
function when(date: Date, now: Date): string {
  const days = Math.round((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return DAY_NAMES[date.getDay()]!;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const inDays = (date: Date, now: Date) => {
  const days = Math.round((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
  return days <= 1 ? '' : `in ${days} days`;
};

const iconOf = (id: string) => STREAMS.find((s) => s.id === id)?.icon ?? 'trash';
const nameOf = (id: string) => STREAMS.find((s) => s.id === id)?.name ?? id;

/** The next pickup of each stream that has one, after this morning's if it is past noon. */
function nextOfEach(schedule: TrashSchedule, now: Date): Pickup[] {
  const from = now.getHours() >= 12 ? addDays(startOfDay(now), 1) : now;
  const seen = new Set<string>();
  return pickups(schedule, from, 21).filter((p) => !seen.has(p.stream) && seen.add(p.stream));
}

export function trashCard(schedule: TrashSchedule, now: Date): PluginBlocksInput {
  if (!schedule.streams.length)
    return {
      title: 'Trash and recycling',
      icon: 'trash',
      lines: [],
      empty: 'Set the pickup days in Settings, Trash and recycling day.',
    };
  const moment = momentAt(schedule, now);
  if (moment.kind !== 'quiet') {
    const tonight = moment.kind === 'tonight';
    const later = nextOfEach(schedule, addDays(moment.date, 1)).filter(
      (p) => !moment.streams.includes(p.stream),
    );
    return {
      title: `${streamNames(moment.streams)} ${tonight ? 'tonight' : 'out today'}`,
      icon: 'trash',
      lines: [
        ...moment.streams.map((id) => ({
          icon: iconOf(id),
          text: nameOf(id),
          sub: tonight ? 'Put it out tonight, pickup tomorrow' : 'Pickup this morning',
          tone: 'warn' as const,
        })),
        ...later.map((p) => line(p, now)),
      ],
    };
  }
  return {
    title: 'Trash and recycling',
    icon: 'trash',
    lines: nextOfEach(schedule, now).map((p) => line(p, now)),
  };
}

function line(p: Pickup, now: Date) {
  const extra = [inDays(p.date, now), p.shifted ? 'a day late for the holiday' : '']
    .filter(Boolean)
    .join(', ');
  return {
    icon: iconOf(p.stream),
    text: nameOf(p.stream),
    sub: `${when(p.date, now)}${extra ? ` · ${extra}` : ''}`,
  };
}

export function trashAmbient(schedule: TrashSchedule, now: Date): PluginBlocksInput | null {
  const moment = momentAt(schedule, now);
  if (moment.kind === 'quiet') return null;
  return {
    title: `${streamNames(moment.streams)} ${moment.kind === 'tonight' ? 'tonight' : 'out today'}`,
    icon: 'trash',
    lines: [],
  };
}

function summary(schedule: TrashSchedule): string {
  return schedule.streams
    .map((s, i) => {
      const name = i === 0 ? nameOf(s.id) : nameOf(s.id).toLowerCase();
      return `${name} ${s.biweekly ? 'every other ' : ''}${DAY_NAMES[s.weekday]}`;
    })
    .join(', ');
}

/**
 * Mock mode's schedule when nothing is saved: trash and recycling tomorrow (so the evening shows
 * the reminder), yard waste three days out, so the card always has something to say.
 */
export function mockTrashConfig(now: Date): IntegrationConfig {
  const day = (n: number) =>
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      addDays(now, n).getDay()
    ]!;
  return {
    trashDay: day(1),
    trashEvery: 'weekly',
    recyclingDay: day(1),
    recyclingEvery: 'biweekly',
    recyclingSince: toIsoDate(addDays(now, 1)),
    yardDay: day(3),
    yardEvery: 'weekly',
    holidayShift: true,
    remindFrom: 16,
  };
}

export interface TrashOptions {
  /** Used when no pickup day is saved (mock mode). */
  fallback?: (now: Date) => IntegrationConfig;
}

export function trashPlugin(opts: TrashOptions = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  const now = () => ctx?.now() ?? new Date();
  const schedule = () => {
    const s = scheduleFrom(config);
    return !s.streams.length && opts.fallback ? scheduleFrom(opts.fallback(now())) : s;
  };
  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply(next) {
      config = next;
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'trash' } });
    },
    async test(next): Promise<TestResult> {
      const s = scheduleFrom(next);
      if (!s.streams.length) return { ok: false, message: 'Pick at least one pickup day.' };
      const missing = s.streams.find((r) => r.biweekly && !r.since);
      if (missing)
        return {
          ok: false,
          message: `${nameOf(missing.id)} is every other week: give a recent pickup date.`,
        };
      const parts = nextOfEach(s, now()).map((p) => {
        const w = when(p.date, now());
        const at = w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : `on ${w}`;
        return `${nameOf(p.stream).toLowerCase()} ${at}`;
      });
      const text = parts.join(', ');
      return { ok: true, message: `Next: ${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
    },
    status(): PluginStatusFields {
      const s = schedule();
      return s.streams.length
        ? { state: 'connected', summary: summary(s), lastOkAt: null, lastError: null }
        : { state: 'not_set_up', summary: 'No pickup days yet', lastOkAt: null, lastError: null };
    },
    blocks(name) {
      if (name === 'card') return trashCard(schedule(), now());
      if (name === 'ambient') return trashAmbient(schedule(), now());
      return undefined;
    },
  };
}
