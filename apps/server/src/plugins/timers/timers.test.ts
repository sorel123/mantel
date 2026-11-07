import { DEVICE_KEY_HEADER, PluginBlocks, PluginChip, type WsEventInput } from '@mantel/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openDb } from '../../db/index.js';
import type { ProviderContext } from '../../providers/types.js';
import { lengthLabel, timersPlugin } from './index.js';

function setup() {
  let clock = new Date(2026, 10, 7, 17, 0, 0);
  const events: WsEventInput[] = [];
  const db = openDb(':memory:');
  const ctx = {
    db,
    emit: (e: WsEventInput) => events.push(e),
    now: () => clock,
  } as unknown as ProviderContext;
  const plugin = timersPlugin();
  plugin.start(ctx);
  void plugin.apply({ chime: true }, {});
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
    vi.advanceTimersByTime(ms);
  };
  return { plugin, events, advance, db, ctx };
}

describe('kitchen timers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('labels lengths the way people say them', () => {
    expect(lengthLabel(45)).toBe('45 s');
    expect(lengthLabel(300)).toBe('5 min');
    expect(lengthLabel(5400)).toBe('1 h 30 min');
    expect(lengthLabel(7200)).toBe('2 hours');
  });

  it('starts timers from a preset and the dial, and counts them in the chip', async () => {
    const { plugin } = setup();
    expect(await plugin.chip!('chip')).toBeNull();
    await plugin.action!('start', { minutes: 5 });
    await plugin.action!('start', { value: 12 });
    const chip = PluginChip.parse(await plugin.chip!('chip'));
    expect(chip.text).toBe('+1');
    expect(chip.countdownTo).toBe('2026-11-07T17:05:00' + chip.countdownTo!.slice(19));
    const sheet = PluginBlocks.parse(await plugin.blocks!('sheet'));
    expect(sheet.lines.map((l) => l.text)).toEqual(['5 min timer', '12 min timer']);
    expect(sheet.actions.map((a) => a.label)).toEqual([
      '1 min',
      '5 min',
      '10 min',
      '20 min',
      '45 min',
    ]);
    expect(sheet.dial?.action).toBe('start');
  });

  it('rings at zero: wakes the displays, sends the banner, and shows Done until stopped', async () => {
    const { plugin, events, advance } = setup();
    await plugin.action!('start', { minutes: 1, label: 'Eggs' });
    events.length = 0;
    advance(59_000);
    expect(events.some((e) => e.type === 'plugin.alert')).toBe(false);
    advance(1_500);
    expect(events.map((e) => e.type)).toEqual(['display.wake', 'plugin.alert', 'plugin.changed']);
    const alert = events[1] as Extract<WsEventInput, { type: 'plugin.alert' }>;
    expect(alert.payload).toMatchObject({ id: 'timers', title: 'Eggs is done', chime: true });
    const chip = PluginChip.parse(await plugin.chip!('chip'));
    expect(chip).toMatchObject({ text: 'Done', tone: 'warn' });
    events.length = 0;
    await plugin.action!('stop', { id: alert.payload.key });
    expect(await plugin.chip!('chip')).toBeNull();
    expect(events).toContainEqual({
      type: 'plugin.changed',
      payload: { id: 'timers', cleared: [alert.payload.key] },
    });
  });

  it('adds a minute, and a rung timer comes back for one more minute', async () => {
    const { plugin, advance } = setup();
    await plugin.action!('start', { minutes: 1 });
    const [t] = plugin.timers();
    await plugin.action!('add', { id: t!.id, minutes: 1 });
    advance(90_000);
    expect(plugin.timers()[0]!.doneAt).toBeUndefined();
    advance(31_000);
    expect(plugin.timers()[0]!.doneAt).toBeDefined();
    await plugin.action!('add', { id: t!.id });
    expect(plugin.timers()[0]!.doneAt).toBeUndefined();
  });

  it('keeps timers across a restart and refuses nonsense', async () => {
    const { plugin, ctx } = setup();
    await plugin.action!('start', { minutes: 20 });
    const again = timersPlugin();
    again.start(ctx);
    expect(again.timers()).toHaveLength(1);
    await expect(plugin.action!('start', { minutes: 0 })).rejects.toThrow(/1 second to 12 hours/);
    await expect(plugin.action!('stop', { id: 'nope' })).rejects.toThrow(/already gone/);
    await expect(plugin.action!('explode', {})).rejects.toThrow();
  });
});

describe('plugin routes (mock mode)', () => {
  const app = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
  afterAll(() => app.close());
  const auth = {
    [DEVICE_KEY_HEADER]: 'mock-device-key-0000000000',
    'content-type': 'application/json',
  };
  const get = (path: string) => app.app.request(`/api${path}`, { headers: auth });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

  it('serves blocks, chips and actions, and 404s for names a plugin does not have', async () => {
    const card = await json(get('/plugins/trash/blocks/card'));
    expect(PluginBlocks.parse(card.blocks).title).toMatch(/Trash/);
    expect((await json(get('/plugins/timers/chip/chip'))).chip).toBeNull();
    const res = await app.app.request('/api/plugins/timers/actions/start', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ args: { minutes: 5 } }),
    });
    expect(await json(res)).toEqual({ ok: true, message: '5 min timer started.' });
    expect((await json(get('/plugins/timers/chip/chip'))).chip.icon).toBe('timer');
    expect((await get('/plugins/trash/blocks/nope')).status).toBe(404);
    expect((await get('/plugins/weather/blocks/card')).status).toBe(404);
  });

  it('shows nothing for a plugin that is turned off', async () => {
    const off = await app.app.request('/api/integrations/trash', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect((await json(get('/plugins/trash/blocks/card'))).blocks).toBeNull();
  });
});
