import { describe, expect, it } from 'vitest';
import { routes, type RouteName } from '../api.js';
import { WS_EVENT_TYPES, WsEvent } from '../ws.js';
import { routeFixtures, wsFixtures } from './index.js';

// Run against a few different "nows" so date math at month and week edges is covered.
const nows = [
  new Date(),
  new Date(2026, 0, 1, 7, 15),
  new Date(2026, 11, 31, 23, 50),
  new Date(2026, 2, 8, 12),
];

describe.each(nows.map((n) => [n.toISOString(), n] as const))('fixtures at %s', (_, now) => {
  const fx = routeFixtures(now);

  it('has a fixture for every JSON route', () => {
    const jsonRoutes = (Object.keys(routes) as RouteName[]).filter(
      (n) => routes[n].response !== null,
    );
    expect(Object.keys(fx).sort()).toEqual(jsonRoutes.sort());
  });

  for (const name of Object.keys(routes) as RouteName[]) {
    const schema = routes[name].response;
    if (!schema) continue;
    it(`${name} matches its response schema`, () => {
      const result = schema.safeParse(fx[name as keyof typeof fx]);
      if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    });
  }

  it('has a valid sample of every WebSocket event', () => {
    const samples = wsFixtures(now);
    expect(samples.map((s) => s.type).sort()).toEqual([...WS_EVENT_TYPES].sort());
    for (const s of samples) WsEvent.parse(s);
  });

  it('puts the mockup day on today', () => {
    const titles = fx.calendar.events.map((e) => e.title);
    expect(titles).toContain('Soccer practice');
    expect(fx.countdowns.countdowns.length).toBeGreaterThan(0);
    expect(fx.meals.meals.filter((m) => m.slot === 'dinner')).toHaveLength(7);
  });
});
