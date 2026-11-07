import { routes, type RouteName } from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
afterAll(() => mock.close());

const req = (app: typeof mock.app, method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('workstream R routes (mock mode)', () => {
  const samples: Array<[RouteName, string, unknown?]> = [
    ['starsBalance', '/stars/balance'],
    ['starsLedger', '/stars/ledger?personId=ava&limit=5'],
    ['starsAdjust', '/stars/adjust', { personId: 'leo', delta: 2, reason: 'bonus', pin: '0000' }],
    ['rewards', '/rewards'],
    ['rewardCreate', '/rewards', { title: 'Late bedtime', cost: 20 }],
    ['rewardPatch', '/rewards/reward-game', { cost: 12 }],
    ['rewardRedeem', '/rewards/reward-movie/redeem', { personId: 'ava', pin: '1234' }],
    ['rewardDelete', '/rewards/reward-icecream'],
    ['routines', '/routines'],
    [
      'routineCreate',
      '/routines',
      { name: 'After school', personIds: ['leo'], timeOfDay: 'afternoon' },
    ],
    ['routinePatch', '/routines/routine-bedtime', { name: 'Bedtime' }],
    ['choreUpdate', '/chores/chore-table', { icon: 'fork', timeOfDay: 'evening' }],
    ['routineDelete', '/routines/routine-bedtime'],
  ];
  for (const [name, path, body] of samples) {
    it(`${routes[name].method} ${routes[name].path} answers within the contract`, async () => {
      const res = await req(mock.app, routes[name].method, path, body);
      expect(res.status, await res.clone().text()).toBe(200);
      routes[name].response!.parse(await res.json());
    });
  }

  it('refuses a redemption without a PIN or without enough stars, in words', async () => {
    expect(
      (await req(mock.app, 'POST', '/rewards/reward-movie/redeem', { personId: 'ava' })).status,
    ).toBe(400);
    await req(mock.app, 'POST', '/rewards', { title: 'Pony', cost: 999 });
    const pony = (
      (await (await req(mock.app, 'GET', '/rewards')).json()) as {
        rewards: Array<{ id: string; title: string }>;
      }
    ).rewards.find((r) => r.title === 'Pony')!;
    const res = await req(mock.app, 'POST', `/rewards/${pony.id}/redeem`, {
      personId: 'leo',
      pin: '1234',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Leo has \d+ stars; Pony needs 999/);
  });
});

describe('workstream R routes (real mode)', () => {
  const real = createApp(loadConfig({ DATA_DIR: ':memory:' }), { env: {} });
  afterAll(() => real.close());

  it('needs the admin PIN to spend or adjust stars', async () => {
    expect((await req(real.app, 'POST', '/admin/pin', { pin: '2468' })).status).toBe(200);
    const key = (
      (await (await req(real.app, 'POST', '/pair', { pin: '2468', name: 'Wall' })).json()) as {
        deviceKey?: string;
      }
    ).deviceKey;
    const call = (method: string, path: string, body?: unknown) =>
      real.app.request(`/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-mantel-device-key': key ?? '' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect(key).toBeTruthy();
    const people = (
      (await (await call('GET', '/settings')).json()) as { people: Array<{ id: string }> }
    ).people;
    const who = people[0]!.id;
    const wrong = await call('POST', '/stars/adjust', { personId: who, delta: 5, pin: '1111' });
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toMatch(/PIN is wrong/);
    const ok = await call('POST', '/stars/adjust', { personId: who, delta: 5, pin: '2468' });
    expect(ok.status).toBe(200);
    const { reward } = (await (
      await call('POST', '/rewards', { title: 'Treat', cost: 4 })
    ).json()) as {
      reward: { id: string };
    };
    const spent = await call('POST', `/rewards/${reward.id}/redeem`, {
      personId: who,
      pin: '2468',
    });
    expect(spent.status).toBe(200);
    expect(((await spent.json()) as { balance: { stars: number } }).balance.stars).toBe(1);
  });
});
