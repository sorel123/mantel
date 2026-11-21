/**
 * House status (v4 G, needs Home Assistant): a tidy card of the things a family checks on the
 * way to bed or out the door. Locks with a one-tap Lock, garage doors with Close, doors, the
 * washer and dryer, and energy today. With nothing listed it picks them from the entities
 * Home Assistant already lets the wall see. Banners when the laundry finishes and (if asked)
 * once a night when something is left open.
 */
import type {
  ConfigValue,
  HomeEntity,
  IntegrationConfig,
  PluginActionInput,
  PluginActionResponse,
  PluginBlocksInput,
  TestResult,
} from '@mantel/shared';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import {
  AlertOnce,
  bool,
  enabled,
  entries,
  every,
  num,
  plural,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export type Role = 'lock' | 'garage' | 'door' | 'appliance' | 'energy';

const APPLIANCE = /washer|washing|dryer|laundry|dishwasher/i;

/** What a shown entity is, or null for things this card does not draw. */
export function roleOf(e: HomeEntity): Role | null {
  const dc = String(e.attrs.device_class ?? '');
  if (e.id.startsWith('lock.')) return 'lock';
  if (e.id.startsWith('cover.') && (dc === 'garage' || dc === 'gate' || /garage|gate/i.test(e.id)))
    return 'garage';
  if (e.id.startsWith('binary_sensor.') && ['door', 'garage_door', 'opening'].includes(dc))
    return 'door';
  if (
    (e.id.startsWith('sensor.') || e.id.startsWith('binary_sensor.')) &&
    APPLIANCE.test(`${e.id} ${e.name}`)
  )
    return 'appliance';
  if (e.id.startsWith('sensor.') && dc === 'energy' && /today|daily|day/i.test(`${e.id} ${e.name}`))
    return 'energy';
  return null;
}

/** The entities to show: the listed ones, or every one with a role. */
export function pick(all: HomeEntity[], listed: string[]): Array<HomeEntity & { role: Role }> {
  const chosen = listed.length ? listed.flatMap((id) => all.filter((e) => e.id === id)) : all;
  const order: Role[] = ['lock', 'garage', 'door', 'appliance', 'energy'];
  return chosen
    .flatMap((e) => {
      const role = roleOf(e) ?? (listed.length ? ('appliance' as const) : null);
      return role ? [{ ...e, role }] : [];
    })
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

/** Appliance state words → running, done or idle. */
export function applianceState(state: string): 'running' | 'done' | 'idle' {
  const s = state.toLowerCase();
  if (/complete|done|finish|end|clean/.test(s)) return 'done';
  if (/run|wash|dry|spin|rinse|on$|active|drying|heating/.test(s) || s === 'on') return 'running';
  return 'idle';
}

const ago = (iso: string | undefined, now: Date) => {
  if (!iso) return '';
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : '';
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface Row {
  e: HomeEntity & { role: Role };
  open: boolean;
  line: NonNullable<PluginBlocksInput['lines']>[number];
}

export function rows(list: Array<HomeEntity & { role: Role }>, now: Date, night: boolean): Row[] {
  return list.map((e) => {
    const when = ago(e.lastChanged, now);
    switch (e.role) {
      case 'lock': {
        const unlocked = e.state === 'unlocked' || e.state === 'open';
        const actions: PluginActionInput[] = unlocked
          ? [
              {
                name: 'call',
                label: 'Lock',
                args: { entity: e.id, service: 'lock' },
                tone: 'primary',
              },
            ]
          : [];
        return {
          e,
          open: unlocked,
          line: {
            id: e.id,
            icon: unlocked ? 'unlock' : 'lock',
            text: e.name,
            sub: cap(e.state === 'unavailable' ? 'Not reachable' : e.state),
            tone: unlocked && night ? 'warn' : unlocked ? 'normal' : 'good',
            actions,
          },
        };
      }
      case 'garage': {
        const open = e.state === 'open' || e.state === 'opening';
        const long =
          open && e.lastChanged && now.getTime() - Date.parse(e.lastChanged) > 15 * 60_000;
        return {
          e,
          open,
          line: {
            id: e.id,
            icon: 'door',
            text: e.name,
            sub: open ? `Open${when ? ` since ${when}` : ''}` : cap(e.state),
            tone: open && (night || long) ? 'warn' : open ? 'normal' : 'good',
            actions: open
              ? [
                  {
                    name: 'call',
                    label: 'Close',
                    args: { entity: e.id, service: 'close_cover' },
                    tone: 'primary',
                  },
                ]
              : [],
          },
        };
      }
      case 'door': {
        const open = e.state === 'on';
        return {
          e,
          open,
          line: {
            id: e.id,
            icon: 'door',
            text: e.name,
            sub: open ? `Open${when ? `, ${when}` : ''}` : 'Closed',
            tone: open && night ? 'warn' : 'normal',
          },
        };
      }
      case 'appliance': {
        const st = applianceState(e.state);
        return {
          e,
          open: false,
          line: {
            id: e.id,
            icon: 'washer',
            text: e.name,
            sub:
              st === 'done'
                ? `Done${when ? ` ${when}` : ''}`
                : st === 'running'
                  ? 'Running'
                  : cap(e.state),
            tone: st === 'done' ? 'good' : 'normal',
          },
        };
      }
      case 'energy': {
        const unit = String(e.attrs.unit_of_measurement ?? 'kWh');
        const value = Number(e.state);
        return {
          e,
          open: false,
          line: {
            id: e.id,
            icon: 'bolt',
            text: e.name,
            sub: Number.isFinite(value) ? `${Math.round(value * 10) / 10} ${unit}` : cap(e.state),
          },
        };
      }
    }
  });
}

export function houseStatusPlugin(deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let entities: HomeEntity[] = [];
  let lastError: string | null = null;
  let lastOkAt: string | null = null;
  let stopTick: (() => void) | null = null;
  let lastSig = '';
  const appliance = new Map<string, string>();
  const alerts = new AlertOnce(() => ctx, 'housestatus');
  const now = () => ctx?.now() ?? new Date();
  const home = () => {
    const h = deps.home?.();
    return h && h.setup.enabled() ? h : null;
  };
  const shown = () => pick(entities, entries(config.entities));
  const night = () => {
    const h = now().getHours();
    return h >= num(config.nightFrom, 21) || h < 5;
  };

  const refresh = async () => {
    const h = home();
    if (!h) {
      entities = [];
      return;
    }
    try {
      entities = (await h.state()).entities;
      lastOkAt = now().toISOString();
      lastError = null;
    } catch (err) {
      lastError = humanError(err);
      return;
    }
    const list = shown();
    const sig = JSON.stringify(list.map((e) => [e.id, e.state]));
    if (lastSig && sig !== lastSig)
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'housestatus' } });
    lastSig = sig;
    if (!ctx || !enabled(ctx, 'housestatus')) return;
    // Laundry done: a banner when an appliance goes from running to done.
    for (const e of list.filter((x) => x.role === 'appliance')) {
      const st = applianceState(e.state);
      const before = appliance.get(e.id);
      appliance.set(e.id, st);
      if (before === 'running' && st === 'done' && bool(config.doneBanner, true))
        alerts.send({
          key: `done|${e.id}|${e.lastChanged ?? now().toISOString()}`,
          title: `${e.name} is done`,
          icon: 'washer',
          chime: true,
        });
    }
    // Once a night, when something is left open.
    if (night() && bool(config.nightBanner, false)) {
      const open = rows(list, now(), true).filter((r) => r.open && r.e.role !== 'door');
      if (open.length)
        alerts.send({
          key: `night|${now().toDateString()}`,
          title:
            open.length === 1
              ? `${open[0]!.e.name} is ${open[0]!.e.role === 'lock' ? 'unlocked' : 'open'}`
              : `${plural(open.length, 'thing')} open for the night`,
          text: open.map((r) => r.e.name).join(', '),
          icon: 'lock',
          chime: true,
          actions: open
            .flatMap((r) => r.line.actions ?? [])
            .map((a) => ({ args: {}, tone: 'normal' as const, ...a })),
        });
    }
  };

  return {
    manifest,
    start(c) {
      ctx = c;
      stopTick = every(60_000, refresh);
    },
    stop() {
      stopTick?.();
    },
    apply(next) {
      config = next;
      lastSig = '';
      void refresh();
    },
    async test(next): Promise<TestResult> {
      const h = home();
      if (!h)
        return { ok: false, message: 'Connect Home Assistant first, in Settings, Home Assistant.' };
      try {
        const all = (await h.state()).entities;
        const listed = entries(next.entities);
        const missing = listed.filter((id) => !all.some((e) => e.id === id));
        if (missing.length)
          return {
            ok: false,
            message: `Home Assistant does not show ${missing[0]} to the wall. Allow it in Settings, Home Assistant, or check the spelling.`,
          };
        const list = pick(all, listed);
        if (!list.length)
          return {
            ok: false,
            message:
              'No locks, garage doors or appliance sensors are allowed yet. Add them in Settings, Home Assistant.',
          };
        return { ok: true, message: `Showing ${list.map((e) => e.name).join(', ')}.` };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      if (!home())
        return {
          state: 'not_set_up',
          summary: 'Needs Home Assistant',
          lastOkAt: null,
          lastError: null,
        };
      const n = shown().length;
      return {
        state: lastError ? 'error' : n ? 'connected' : 'not_set_up',
        summary: n
          ? `${entries(config.entities).length ? 'Showing' : 'Picked for you:'} ${plural(n, 'thing')}`
          : 'Nothing to show yet',
        lastOkAt,
        lastError,
      };
    },
    async blocks(name) {
      if (name !== 'card' && name !== 'ambient') return undefined;
      if (!entities.length) await refresh();
      const list = rows(shown(), now(), night());
      if (name === 'ambient') {
        const warn = list.filter((r) => r.line.tone === 'warn');
        if (!warn.length) return null;
        const r = warn[0]!;
        return {
          title:
            warn.length === 1
              ? `${r.e.name} is ${r.e.role === 'lock' ? 'unlocked' : 'open'}`
              : `${plural(warn.length, 'thing')} open`,
          icon: r.e.role === 'lock' ? 'unlock' : 'door',
          lines: [],
        };
      }
      if (!home())
        return {
          title: 'House status',
          icon: 'house',
          lines: [],
          empty: 'Connect Home Assistant in Settings to see locks, the garage and the laundry.',
        };
      const open = list.filter((r) => r.open);
      return {
        title: open.length
          ? `${plural(open.length, 'thing')} open`
          : list.length
            ? 'All locked up'
            : 'House status',
        icon: 'house',
        lines: list.map((r) => r.line),
        empty: 'Allow a lock, the garage door or the laundry sensor in Settings, Home Assistant.',
        ...(open.filter((r) => r.e.role === 'lock').length > 1
          ? { actions: [{ name: 'lock-all', label: 'Lock all', tone: 'primary' as const }] }
          : {}),
      };
    },
    async action(name, args: Record<string, ConfigValue>): Promise<PluginActionResponse> {
      const h = home();
      if (!h) throw new HttpError('bad_request', 'Home Assistant is not connected.');
      const list = shown();
      const calls: Array<{ entityId: string; service: string; label: string }> = [];
      if (name === 'call') {
        const e = list.find((x) => x.id === args.entity);
        const service = String(args.service ?? '');
        const allowed =
          e &&
          ((e.role === 'lock' && service === 'lock') ||
            (e.role === 'garage' && service === 'close_cover'));
        if (!e || !allowed)
          throw new HttpError('bad_request', 'That is not something this card can do.');
        calls.push({ entityId: e.id, service, label: e.name });
      } else if (name === 'lock-all') {
        for (const e of list.filter((x) => x.role === 'lock' && x.state === 'unlocked'))
          calls.push({ entityId: e.id, service: 'lock', label: e.name });
      } else throw new HttpError('not_found', `House status can’t ${name}.`);
      for (const c of calls) await h.call({ entityId: c.entityId, service: c.service });
      await refresh();
      return {
        ok: true,
        message: calls.length
          ? `${calls.map((c) => c.label).join(', ')}: ${calls[0]!.service === 'lock' ? 'locking' : 'closing'}.`
          : 'Everything is already locked.',
      };
    },
  };
}
