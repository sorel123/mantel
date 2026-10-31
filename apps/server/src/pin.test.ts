import { describe, expect, it } from 'vitest';
import { DeviceAuth } from './auth.js';
import { openDb } from './db/index.js';

describe('admin PIN', () => {
  it('is set on first run, then needs the current PIN to change', () => {
    const auth = new DeviceAuth(openDb(':memory:'), false);
    expect(auth.firstRun()).toBe(true);
    expect(auth.pinChangeProblem(undefined, false)).toBeNull();
    auth.setPin('1234');
    expect(auth.pinSet()).toBe(true);
    expect(auth.firstRun()).toBe(false);
    expect(auth.pinChangeProblem(undefined, true)).toMatch(/current PIN is needed/);
    expect(auth.pinChangeProblem('0000', true)).toMatch(/wrong/);
    expect(auth.pinChangeProblem('1234', false)).toBeNull();
    auth.setPin('5678');
    expect(auth.verifyPin('1234')).toBe(false);
    expect(auth.verifyPin('5678')).toBe(true);
  });

  it('after an upgrade with displays but no PIN, only a paired display may set it', () => {
    const auth = new DeviceAuth(openDb(':memory:'), false);
    auth.pair(auth.currentCode(), 'Kitchen');
    expect(auth.firstRun()).toBe(false);
    expect(auth.pinChangeProblem(undefined, false)).toMatch(/pair a display/);
    expect(auth.pinChangeProblem(undefined, true)).toBeNull();
  });

  it('pairs a display with the PIN and locks out after five wrong tries', () => {
    const auth = new DeviceAuth(openDb(':memory:'), false);
    auth.setPin('2468');
    expect(auth.pairWithPin('1111')).toBeNull();
    const paired = auth.pairWithPin('2468', 'Phone');
    expect(paired).not.toBeNull();
    expect(auth.verify(paired!.deviceKey)).toBe(paired!.deviceId);
    for (let i = 0; i < 5; i++) auth.verifyPin('0000');
    expect(auth.pinLocked()).toBe(true);
    expect(auth.verifyPin('2468')).toBe(false);
  });

  it('keeps per-display overrides and clears them with null', () => {
    const auth = new DeviceAuth(openDb(':memory:'), false);
    const { deviceId } = auth.pair(auth.currentCode(), 'Surface')!;
    let d = auth.patch(deviceId, { look: 'dusk', scale: 1.1 }, deviceId)!;
    expect(d).toMatchObject({ name: 'Surface', look: 'dusk', scale: 1.1, current: true });
    d = auth.patch(deviceId, { name: 'Hall', look: null }, deviceId)!;
    expect(d.name).toBe('Hall');
    expect(d.look).toBeUndefined();
    expect(d.scale).toBe(1.1);
    expect(auth.patch('nope', { name: 'x' }, null)).toBeNull();
  });
});
