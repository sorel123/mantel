/**
 * Kitchen timers. Timers live on the server (in the kv table, so a restart keeps them), every
 * display shows them through the dock chip, the sheet and Ambient, and when one reaches zero
 * the server wakes every display and sends a `plugin.alert` for the banner and chime.
 */
import {
  PluginAction as PluginActionSchema,
  toLocalIso,
  type ConfigValue,
  type PluginActionInput,
  type PluginActionResponse,
  type PluginBlocksInput,
  type PluginChipInput,
  type TestResult,
} from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface Timer {
  id: string;
  label: string;
  /** What it was set for, in seconds (shown as "10 min"). */
  seconds: number;
  /** ISO time it rings; moves with "+1 min". */
  endsAt: string;
  /** Set once it has rung. */
  doneAt?: string;
}

const KV_KEY = 'plugin.timers';
export const PRESETS = [1, 5, 10, 20, 45];
export const MAX_TIMERS = 8;
/** A rung timer that nobody stopped clears itself after this long. */
const DONE_KEEP_MS = 15 * 60_000;
const MAX_SECONDS = 12 * 3600;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "10 min", "1 h 30 min", "45 s". */
export function lengthLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : plural(h, 'hour');
}

const num = (v: ConfigValue | undefined): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function timersPlugin(): Plugin & { timers(): Timer[] } {
  let ctx: ProviderContext | null = null;
  let chime = true;
  let timers: Timer[] = [];
  let tick: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const now = () => ctx?.now() ?? new Date();
  const save = () => {
    if (ctx) kvSet(ctx.db, KV_KEY, timers);
  };
  const changed = (cleared: string[] = []) =>
    ctx?.emit({
      type: 'plugin.changed',
      payload: { id: 'timers', ...(cleared.length ? { cleared } : {}) },
    });

  /** Drop rung timers nobody stopped, then ring any that are due and wait for the next. */
  const schedule = () => {
    clearTimeout(tick);
    const t = now().getTime();
    const stale = timers.filter((x) => x.doneAt && t - Date.parse(x.doneAt) > DONE_KEEP_MS);
    if (stale.length) {
      timers = timers.filter((x) => !stale.includes(x));
      save();
      changed(stale.map((x) => x.id));
    }
    const due = timers.filter((x) => !x.doneAt && Date.parse(x.endsAt) <= t);
    for (const x of due) ring(x);
    const next = timers
      .map((x) => (x.doneAt ? Date.parse(x.doneAt) + DONE_KEEP_MS : Date.parse(x.endsAt)))
      .sort((a, b) => a - b)[0];
    if (next !== undefined)
      tick = setTimeout(schedule, Math.max(50, Math.min(next - t, 2 ** 31 - 1)));
  };

  const ring = (x: Timer) => {
    x.doneAt = toLocalIso(now());
    save();
    if (!ctx) return;
    ctx.emit({ type: 'display.wake', payload: { reason: 'manual' } });
    ctx.emit({
      type: 'plugin.alert',
      payload: {
        id: 'timers',
        key: x.id,
        title: `${x.label} is done`,
        text: `Set for ${lengthLabel(x.seconds)}`,
        icon: 'bell',
        chime,
        actions: PluginActionSchema.array().parse(rowActions(x, 'Stop')),
      },
    });
    changed();
  };

  const find = (args: Record<string, ConfigValue>) => {
    const x = timers.find((t) => t.id === args.id);
    if (!x) throw new HttpError('not_found', 'That timer is already gone.');
    return x;
  };

  const start = (seconds: number, label?: string): Timer => {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS)
      throw new HttpError('bad_request', 'A timer runs from 1 second to 12 hours.');
    if (timers.length >= MAX_TIMERS)
      throw new HttpError('bad_request', `${MAX_TIMERS} timers are running. Stop one first.`);
    const at = now();
    const x: Timer = {
      id: `t${at.getTime().toString(36)}${(seq++).toString(36)}`,
      label: label?.trim() || `${lengthLabel(seconds)} timer`,
      seconds: Math.round(seconds),
      endsAt: toLocalIso(new Date(at.getTime() + Math.round(seconds) * 1000)),
    };
    timers = [...timers, x];
    return x;
  };

  const running = () => timers.filter((x) => !x.doneAt);
  const rung = () => timers.filter((x) => x.doneAt);
  const byEnd = (a: Timer, b: Timer) => Date.parse(a.endsAt) - Date.parse(b.endsAt);

  const presets = (): PluginActionInput[] =>
    PRESETS.map((m) => ({ name: 'start', label: `${m} min`, args: { minutes: m } }));

  const rowActions = (x: Timer, stop: 'Stop' | 'Cancel'): PluginActionInput[] => [
    { name: 'add', label: '+1 min', args: { id: x.id, minutes: 1 } },
    { name: 'stop', label: stop, args: { id: x.id }, tone: stop === 'Stop' ? 'primary' : 'normal' },
  ];

  const sheet = (): PluginBlocksInput => ({
    title: 'Kitchen timers',
    icon: 'timer',
    lines: [
      ...rung().map((x) => ({
        id: x.id,
        icon: 'bell',
        text: x.label,
        sub: 'Done',
        tone: 'warn' as const,
        actions: rowActions(x, 'Stop'),
      })),
      ...running()
        .sort(byEnd)
        .map((x) => ({
          id: x.id,
          icon: 'timer',
          text: x.label,
          countdownTo: x.endsAt,
          actions: rowActions(x, 'Cancel'),
        })),
    ],
    empty: 'No timers running. Pick one below.',
    actions: presets(),
    dial: {
      action: 'start',
      label: 'Or set your own',
      submit: 'Start',
      unit: 'min',
      min: 1,
      max: 180,
      step: 1,
      value: 15,
    },
  });

  const chipFor = (): PluginChipInput | null => {
    const done = rung();
    if (done.length)
      return {
        text: done.length > 1 ? `${done.length} done` : 'Done',
        icon: 'bell',
        tone: 'warn',
        label: `${done.map((x) => x.label).join(', ')} done. Open timers`,
      };
    const list = running().sort(byEnd);
    if (!list.length) return null;
    return {
      text: list.length > 1 ? `+${list.length - 1}` : '',
      icon: 'timer',
      countdownTo: list[0]!.endsAt,
      label: `${plural(list.length, 'timer')} running. Open timers`,
    };
  };

  const ambient = (): PluginBlocksInput | null => {
    if (!timers.length) return null;
    return {
      title: 'Timers',
      icon: 'timer',
      lines: [
        ...rung().map((x) => ({ id: x.id, text: x.label, sub: 'Done', tone: 'warn' as const })),
        ...running()
          .sort(byEnd)
          .map((x) => ({ id: x.id, text: x.label, countdownTo: x.endsAt })),
      ],
    };
  };

  return {
    manifest,
    timers: () => timers,
    start(c) {
      ctx = c;
      timers = kvGet<Timer[]>(c.db, KV_KEY) ?? [];
      schedule();
    },
    stop() {
      clearTimeout(tick);
    },
    apply(config) {
      chime = config.chime !== false;
    },
    async test(): Promise<TestResult> {
      return {
        ok: true,
        message: 'Timers are built in. Tap the timer chip in the dock to start one.',
      };
    },
    status(): PluginStatusFields {
      const n = running().length;
      return {
        state: 'connected',
        summary: n ? `${plural(n, 'timer')} running` : 'Ready, from the dock',
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      if (name === 'sheet') return sheet();
      if (name === 'ambient') return ambient();
      return undefined;
    },
    chip(name) {
      return name === 'chip' ? chipFor() : undefined;
    },
    async action(name, args): Promise<PluginActionResponse> {
      switch (name) {
        case 'start': {
          // Presets send minutes; the dial sends `value` in its unit (minutes).
          const minutes = num(args.minutes) ?? num(args.value);
          const seconds = num(args.seconds) ?? (minutes === null ? null : minutes * 60);
          if (seconds === null) throw new HttpError('bad_request', 'How long? Send minutes.');
          const x = start(seconds, typeof args.label === 'string' ? args.label : undefined);
          save();
          schedule();
          changed();
          return { ok: true, message: `${x.label} started.` };
        }
        case 'add': {
          const x = find(args);
          const extra = Math.round((num(args.minutes) ?? 1) * 60);
          const base = x.doneAt ? now().getTime() : Date.parse(x.endsAt);
          x.endsAt = toLocalIso(new Date(base + extra * 1000));
          const wasDone = Boolean(x.doneAt);
          delete x.doneAt;
          save();
          schedule();
          changed(wasDone ? [x.id] : []);
          return { ok: true, message: `${x.label}: ${lengthLabel(extra)} more.` };
        }
        case 'stop': {
          const x = find(args);
          timers = timers.filter((t) => t !== x);
          save();
          schedule();
          changed([x.id]);
          return { ok: true, message: x.doneAt ? `${x.label} stopped.` : `${x.label} cancelled.` };
        }
        default:
          throw new HttpError('not_found', `Timers can't ${name}.`);
      }
    },
  };
}
