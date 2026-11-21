/**
 * Pet care (v4 G): "Has the dog been fed?" Each pet's jobs for the day with a time; one tap on a
 * person's name marks it done by them. Marks live in kv by date, so the day resets itself at
 * midnight. A job turns orange at its time and sends a banner once it is late.
 */
import {
  toIsoDate,
  type ConfigValue,
  type IntegrationConfig,
  type PluginActionInput,
  type PluginActionResponse,
  type PluginBlocksInput,
  type PluginChipInput,
  type TestResult,
} from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import {
  AlertOnce,
  at,
  bool,
  cap,
  clock,
  enabled,
  entries,
  every,
  joinAnd,
  num,
  parseClock,
  plural,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface PetTask {
  /** `biscuit/dinner`. */
  key: string;
  pet: string;
  label: string;
  /** Minutes after midnight, or null for "any time today". */
  minutes: number | null;
}

export interface Mark {
  at: string;
  by: string | null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** "Biscuit: breakfast 7:30, dinner 17:30, walk; Luna: meds 8pm" → tasks. */
export function parsePets(text: unknown): PetTask[] {
  const out: PetTask[] = [];
  for (const entry of entries(text)) {
    const colon = entry.indexOf(':');
    if (colon < 1) continue;
    const pet = entry.slice(0, colon).trim();
    for (const part of entry.slice(colon + 1).split(',')) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      // The time is the last one or two words ("7:30", "7:30 pm", "8pm").
      let minutes: number | null = null;
      for (const n of [2, 1]) {
        if (words.length > n) {
          const m = parseClock(words.slice(-n).join(' '));
          if (m !== null) {
            minutes = m;
            words.splice(-n);
            break;
          }
        }
      }
      const label = cap(words.join(' '));
      out.push({ key: `${slug(pet)}/${slug(label)}`, pet, label, minutes });
    }
  }
  return out;
}

const ICONS: Array<[RegExp, string]> = [
  [/med|pill|tablet|insulin|drops|vitamin/i, 'pill'],
  [/walk|out|potty/i, 'paw'],
];
const iconFor = (t: PetTask) => ICONS.find(([re]) => re.test(t.label))?.[1] ?? 'paw';

export const MOCK_PETS =
  'Biscuit: breakfast 7:30, dinner 17:30, walk 18:30; Luna: breakfast 7:00, meds 20:00';

type State = 'done' | 'later' | 'due' | 'late';

export function petsPlugin(deps: PackDeps = {}): Plugin & { marks(): Record<string, Mark> } {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let stopTick: (() => void) | null = null;
  const alerts = new AlertOnce(() => ctx, 'pets');
  const now = () => ctx?.now() ?? new Date();
  const kvKey = () => `plugin.pets.${toIsoDate(now())}`;

  const tasks = () => parsePets(!config.pets && deps.mock ? MOCK_PETS : config.pets);
  const grace = () => num(config.grace, 60);
  const marks = (): Record<string, Mark> => (ctx ? (kvGet(ctx.db, kvKey()) ?? {}) : {});
  const save = (m: Record<string, Mark>) => ctx && kvSet(ctx.db, kvKey(), m);
  const changed = (cleared: string[] = []) =>
    ctx?.emit({
      type: 'plugin.changed',
      payload: { id: 'pets', ...(cleared.length ? { cleared } : {}) },
    });

  const stateOf = (t: PetTask, m: Record<string, Mark>): State => {
    if (m[t.key]) return 'done';
    if (t.minutes === null) return 'due';
    const due = at(now(), t.minutes).getTime();
    const n = now().getTime();
    if (n < due - 60 * 60_000) return 'later';
    if (n < due + grace() * 60_000) return 'due';
    return 'late';
  };

  const people = () => ctx?.settings().people.map((p) => p.name) ?? [];
  const doneButtons = (t: PetTask): PluginActionInput[] => {
    const names = people();
    if (names.length >= 1 && names.length <= 4)
      return names.map((by) => ({ name: 'done', label: by, args: { task: t.key, by } }));
    return [{ name: 'done', label: 'Done', args: { task: t.key }, tone: 'primary' }];
  };

  const card = (): PluginBlocksInput => {
    const list = tasks();
    const m = marks();
    const pets = [...new Set(list.map((t) => t.pet))];
    const open = list.filter((t) => stateOf(t, m) !== 'done');
    const late = list.filter((t) => stateOf(t, m) === 'late');
    return {
      title: !list.length
        ? 'Pet care'
        : !open.length
          ? `${joinAnd(pets)} ${pets.length > 1 ? 'are' : 'is'} all set`
          : late.length
            ? `${late[0]!.pet}’s ${late[0]!.label.toLowerCase()} is late`
            : pets.length === 1
              ? pets[0]!
              : 'Pet care',
      icon: 'paw',
      progress: list.length ? (list.length - open.length) / list.length : undefined,
      lines: list.map((t) => {
        const s = stateOf(t, m);
        const mark = m[t.key];
        const time = t.minutes === null ? null : clock(at(now(), t.minutes));
        return {
          id: t.key,
          icon: s === 'done' ? 'check' : iconFor(t),
          text: pets.length > 1 ? `${t.pet} · ${t.label}` : t.label,
          sub:
            s === 'done'
              ? `Done ${clock(new Date(mark!.at))}${mark!.by ? ` by ${mark!.by}` : ''}`
              : s === 'late'
                ? `Late, due ${time}`
                : time
                  ? `Due ${time}`
                  : 'Today',
          tone:
            s === 'done'
              ? ('good' as const)
              : s === 'late' || (s === 'due' && time)
                ? ('warn' as const)
                : 'normal',
          actions:
            s === 'done'
              ? [{ name: 'undo', label: 'Undo', args: { task: t.key } }]
              : s === 'later'
                ? []
                : doneButtons(t),
        };
      }),
      empty: 'Add your pets and their jobs in Settings, Plugins, Pet care.',
    };
  };

  /** Banner once per late job per day. */
  const check = () => {
    if (!ctx || !bool(config.nudge, true) || !enabled(ctx, 'pets')) return;
    const m = marks();
    for (const t of tasks())
      if (stateOf(t, m) === 'late')
        alerts.send({
          key: `${toIsoDate(now())}|${t.key}`,
          title: `Has ${t.pet} had ${t.label.toLowerCase()}?`,
          text: `It was due at ${clock(at(now(), t.minutes!))}.`,
          icon: iconFor(t),
          chime: true,
          actions: doneButtons(t).map((a) => ({ args: {}, tone: 'normal' as const, ...a })),
        });
  };

  const find = (args: Record<string, ConfigValue>) => {
    const t = tasks().find((x) => x.key === args.task);
    if (!t) throw new HttpError('not_found', 'That job is no longer on the list.');
    return t;
  };

  return {
    manifest,
    marks,
    start(c) {
      ctx = c;
      let last = '';
      stopTick = every(60_000, () => {
        check();
        // Jobs change colour with the clock: tell the displays when one does.
        const m = marks();
        const sig = tasks()
          .map((t) => stateOf(t, m))
          .join();
        if (last && sig !== last) changed();
        last = sig;
      });
    },
    stop() {
      stopTick?.();
    },
    apply(next) {
      config = next;
      changed();
    },
    async test(next): Promise<TestResult> {
      const list = parsePets(next.pets);
      if (!list.length)
        return {
          ok: false,
          message: 'Write each pet as Name: job time, like Biscuit: dinner 17:30.',
        };
      const pets = [...new Set(list.map((t) => t.pet))];
      return { ok: true, message: `${joinAnd(pets)}: ${plural(list.length, 'job')} a day.` };
    },
    status(): PluginStatusFields {
      const list = tasks();
      if (!list.length)
        return { state: 'not_set_up', summary: 'No pets yet', lastOkAt: null, lastError: null };
      const pets = [...new Set(list.map((t) => t.pet))];
      return {
        state: 'connected',
        summary: `${joinAnd(pets)}, ${plural(list.length, 'job')} a day`,
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      if (name === 'card') return card();
      if (name === 'ambient') {
        const m = marks();
        const late = tasks().filter((t) => stateOf(t, m) === 'late');
        if (!late.length) return null;
        return {
          title:
            late.length === 1
              ? `${late[0]!.pet}’s ${late[0]!.label.toLowerCase()} is late`
              : `${plural(late.length, 'pet job')} late`,
          icon: 'paw',
          lines: [],
        };
      }
      return undefined;
    },
    chip(name): PluginChipInput | null | undefined {
      if (name !== 'chip') return undefined;
      const m = marks();
      const open = tasks().filter(
        (t) => ['due', 'late'].includes(stateOf(t, m)) && t.minutes !== null,
      );
      if (!open.length) return null;
      const late = open.some((t) => stateOf(t, m) === 'late');
      const first = open[0]!;
      return {
        text:
          open.length > 1
            ? `${first.label} +${open.length - 1}`
            : `${first.pet}: ${first.label.toLowerCase()}`,
        icon: 'paw',
        tone: late ? 'warn' : 'normal',
        label: `${open.map((t) => `${t.pet} ${t.label.toLowerCase()}`).join(', ')} due. Open pet care`,
      };
    },
    async action(name, args): Promise<PluginActionResponse> {
      const t = find(args);
      const m = marks();
      if (name === 'done') {
        const by = typeof args.by === 'string' && args.by.trim() ? args.by.trim() : null;
        m[t.key] = { at: now().toISOString(), by };
        save(m);
        changed([`${toIsoDate(now())}|${t.key}`]);
        return {
          ok: true,
          message: `${t.pet}: ${t.label.toLowerCase()} done${by ? ` by ${by}` : ''}.`,
        };
      }
      if (name === 'undo') {
        delete m[t.key];
        save(m);
        changed();
        return { ok: true, message: `${t.pet}: ${t.label.toLowerCase()} not done.` };
      }
      throw new HttpError('not_found', `Pet care can’t ${name}.`);
    },
  };
}
