import { settings as defaultSettings } from '@mantel/shared/fixtures';
import type { WsEventInput } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from './db/index.js';
import { DisplayScheduler } from './schedule.js';
import { SettingsStore } from './settings.js';

function setup() {
  const store = new SettingsStore(openDb(':memory:'));
  store.put({ ...defaultSettings(), timezone: 'UTC' });
  const sent: WsEventInput[] = [];
  const scheduler = new DisplayScheduler(store, (e) => sent.push(e));
  const at = (hhmm: string) => new Date(`2026-10-31T${hhmm}:00Z`);
  return { store, sent, scheduler, at };
}

describe('display scheduler', () => {
  it('sends sleep, wake and the nightly reload as the clock passes each boundary', () => {
    const { sent, scheduler, at } = setup();
    scheduler.tick(at('22:59'));
    scheduler.tick(at('23:00'));
    scheduler.tick(at('23:00'));
    expect(sent).toEqual([{ type: 'display.sleep', payload: { reason: 'schedule' } }]);
    scheduler.tick(at('03:59'));
    scheduler.tick(at('04:00'));
    expect(sent.at(-1)).toEqual({ type: 'display.reload', payload: {} });
    scheduler.tick(at('06:01'));
    expect(sent.at(-1)).toEqual({ type: 'display.wake', payload: { reason: 'schedule' } });
    expect(sent).toHaveLength(3);
  });

  it('sends nothing on the first tick and follows settings changes', () => {
    const { store, sent, scheduler, at } = setup();
    scheduler.tick(at('04:00'));
    expect(sent).toHaveLength(0);
    const s = store.get();
    store.put({ ...s, schedule: { ...s.schedule, reloadAt: '04:30' } });
    scheduler.tick(at('04:30'));
    expect(sent).toEqual([{ type: 'display.reload', payload: {} }]);
  });

  it('never sleeps when the off window is empty', () => {
    const { store, sent, scheduler, at } = setup();
    const s = store.get();
    store.put({ ...s, schedule: { ...s.schedule, offFrom: '23:00', onAt: '23:00' } });
    scheduler.tick(at('22:59'));
    scheduler.tick(at('23:01'));
    expect(sent).toHaveLength(0);
  });
});
