import { addDays, startOfWeek, toIsoDate } from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
const off = createApp(loadConfig({ MOCK: '1', MOCK_EMPTY: '1', DATA_DIR: ':memory:' }));
afterAll(() => {
  mock.close();
  off.close();
});

const call = (app: typeof mock.app, method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const monday = startOfWeek(new Date());
const day = (n: number) => toIsoDate(addDays(monday, n));

describe('Magic Import commit', () => {
  it('plans imported meals in the meal planner while it is on', async () => {
    const res = await call(mock.app, 'POST', '/import/commit', {
      meals: [{ date: day(5), slot: 'lunch', title: 'Soup from the flyer' }],
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.meals).toBe(1);
    expect(out.problems).toEqual([]);
    const week = await json(await call(mock.app, 'GET', `/meals/week?start=${day(0)}`));
    const soup = week.meals.find(
      (m: { date: string; slot: string }) => m.date === day(5) && m.slot === 'lunch',
    );
    expect(soup).toMatchObject({ title: 'Soup from the flyer', source: 'mantel' });
  });

  it('falls back to the Meals calendar when the planner is off', async () => {
    const s = await json(await call(off.app, 'GET', '/settings'));
    await call(off.app, 'PUT', '/settings', {
      ...s,
      integrations: { ...s.integrations, meals: { enabled: false } },
    });
    const res = await call(off.app, 'POST', '/import/commit', {
      meals: [{ date: day(2), slot: 'dinner', title: 'Tacos' }],
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    // MOCK_EMPTY has no Meals calendar to write to, so the person is told what to connect.
    expect(out.meals).toBe(0);
    expect(out.problems.join(' ')).toMatch(/Meals calendar/);
  });
});
