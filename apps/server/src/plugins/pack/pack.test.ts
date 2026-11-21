/**
 * v4 G: one test per pack plugin (parsing, the card it draws, its buttons and banners), each with
 * a hand-made context like the timers test. Every answer is parsed with the shared schema, so
 * what the display receives is checked too.
 */
import {
  PluginBlocks,
  PluginChip,
  type HomeEntity,
  type IntegrationConfig,
  type Settings,
  type WsEventInput,
} from '@mantel/shared';
import { settings as settingsFixture } from '@mantel/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import type { HomeProvider, ProviderContext } from '../../providers/types.js';
import { birthdaysPlugin, headline, parseBirthday, upcoming } from '../birthdays/index.js';
import { habitsPlugin, parseHabit } from '../habits/index.js';
import { applianceState, houseStatusPlugin, roleOf } from '../housestatus/index.js';
import { parsePets, petsPlugin } from '../pets/index.js';
import { parsePoll, pollPlugin } from '../poll/index.js';
import { questionFor, questionsFor, qotdPlugin } from '../qotd/index.js';
import {
  dayFor,
  parseClosures,
  parseMenu,
  schoolPlugin,
  type SchoolData,
} from '../school/index.js';
import { moonPhase, seasons, skyPlugin, sunTimes } from '../sky/index.js';
import { gameFrom, parseTeams, pickGame, sportsPlugin } from '../sports/index.js';
import type { Plugin } from '../types.js';
import { parseClock } from './util.js';

const people = [
  { id: 'jay', name: 'Jay', initial: 'J', color: '#336699', calendarIds: [] },
  { id: 'mia', name: 'Mia', initial: 'M', color: '#993366', calendarIds: [] },
];

function setup<P extends Plugin>(make: () => P, config: IntegrationConfig, at: Date) {
  let clock = at;
  const events: WsEventInput[] = [];
  const settings = {
    ...settingsFixture(),
    people,
    location: { name: 'Detroit', latitude: 42.33, longitude: -83.05, query: '' },
  } as Settings;
  const ctx = {
    db: openDb(':memory:'),
    emit: (e: WsEventInput) => events.push(e),
    now: () => clock,
    settings: () => settings,
  } as unknown as ProviderContext;
  const plugin = make();
  plugin.start(ctx);
  void plugin.apply(config, {});
  const blocks = async (name = 'card') => {
    const b = await plugin.blocks!(name);
    return b ? PluginBlocks.parse(b) : b;
  };
  const alerts = () => events.filter((e) => e.type === 'plugin.alert');
  const set = (d: Date) => {
    clock = d;
  };
  return { plugin, events, blocks, alerts, set, ctx };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pack helpers', () => {
  it('reads clock times the way people type them', () => {
    expect(parseClock('7:30')).toBe(450);
    expect(parseClock('17:30')).toBe(1050);
    expect(parseClock('8pm')).toBe(1200);
    expect(parseClock('12 am')).toBe(0);
    expect(parseClock('dinner')).toBeNull();
  });
});

describe('birthdays', () => {
  it('reads names and dates in several shapes', () => {
    expect(parseBirthday('Mia 2015-03-14')).toMatchObject({
      name: 'Mia',
      month: 3,
      day: 14,
      year: 2015,
      kind: 'birthday',
    });
    expect(parseBirthday('Grandma Rose 03-02')).toMatchObject({ name: 'Grandma Rose', year: null });
    expect(parseBirthday('Mom and Dad anniversary 2010-06-12')).toMatchObject({
      name: 'Mom and Dad',
      kind: 'anniversary',
    });
    expect(parseBirthday('Leo Mar 9, 2019')).toMatchObject({
      name: 'Leo',
      month: 3,
      day: 9,
      year: 2019,
    });
    expect(parseBirthday('nothing here')).toBeNull();
  });

  it('counts down, gives ages, and sends one banner on the day', async () => {
    const now = new Date(2026, 2, 11, 9, 0);
    const { blocks, plugin, alerts, set } = setup(
      () => birthdaysPlugin(),
      { list: 'Mia 2015-03-14; Grandma 04-02' },
      now,
    );
    const card = (await blocks())!;
    expect(card.lines[0]!.text).toBe('Mia turns 11');
    expect(card.lines[0]!.sub).toBe('Saturday · in 3 days');
    expect(card.lines[1]!.text).toBe('Grandma’s birthday');
    expect(await plugin.chip!('chip')).toBeNull();

    set(new Date(2026, 2, 14, 8, 0));
    vi.advanceTimersByTime(10 * 60_000);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.payload).toMatchObject({ title: 'Happy birthday, Mia!', text: '11 today' });
    vi.advanceTimersByTime(10 * 60_000);
    expect(alerts()).toHaveLength(1);
    expect(PluginChip.parse(await plugin.chip!('chip')).text).toBe('Mia');
    expect((await blocks('ambient'))!.title).toBe('Happy birthday, Mia, 11 today');
  });

  it('keeps Feb 29 birthdays in other years', () => {
    const [u] = upcoming(
      [{ name: 'Leap', month: 2, day: 29, year: 2016, kind: 'birthday' }],
      new Date(2027, 1, 1),
      60,
    );
    expect(u!.date.getDate()).toBe(28);
    expect(headline(u!)).toBe('Leap turns 11');
  });
});

describe('pet care', () => {
  it('reads pets, jobs and times', () => {
    const tasks = parsePets('Biscuit: breakfast 7:30, dinner 5:30 pm, walk; Luna: meds 8pm');
    expect(tasks.map((t) => [t.key, t.minutes])).toEqual([
      ['biscuit/breakfast', 450],
      ['biscuit/dinner', 1050],
      ['biscuit/walk', null],
      ['luna/meds', 1200],
    ]);
  });

  it('marks a job with who and when, nudges once when late, resets the next day', async () => {
    const { blocks, plugin, alerts, set } = setup(
      () => petsPlugin(),
      { pets: 'Biscuit: dinner 17:30', grace: 30 },
      new Date(2026, 10, 21, 17, 40),
    );
    let line = (await blocks())!.lines[0]!;
    expect(line.sub).toBe('Due 5:30 PM');
    expect(line.actions.map((a) => a.label)).toEqual(['Jay', 'Mia']);
    expect(PluginChip.parse(await plugin.chip!('chip')).text).toBe('Biscuit: dinner');

    set(new Date(2026, 10, 21, 18, 5));
    vi.advanceTimersByTime(60_000);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.payload).toMatchObject({ title: 'Has Biscuit had dinner?' });
    expect((await blocks('ambient'))!.title).toBe('Biscuit’s dinner is late');

    await plugin.action!('done', { task: 'biscuit/dinner', by: 'Mia' });
    line = (await blocks())!.lines[0]!;
    expect(line.sub).toBe('Done 6:05 PM by Mia');
    expect(line.tone).toBe('good');
    expect(await plugin.chip!('chip')).toBeNull();

    set(new Date(2026, 10, 22, 9, 0));
    expect((await blocks())!.lines[0]!.sub).toBe('Due 5:30 PM');
  });
});

describe('family poll', () => {
  it('reads choices from a question', () => {
    expect(parsePoll('Pizza or tacos?')).toEqual({
      question: 'Pizza or tacos?',
      options: ['Pizza', 'Tacos'],
    });
    expect(parsePoll('Dinner: pizza, tacos or curry')!.options).toEqual([
      'Pizza',
      'Tacos',
      'Curry',
    ]);
    expect(parsePoll('Movie night?')!.options).toEqual(['Yes', 'No']);
  });

  it('takes a vote per person, closes when everyone voted and names the winner', async () => {
    const { blocks, plugin, alerts } = setup(() => pollPlugin(), {}, new Date(2026, 10, 21, 17, 0));
    const empty = (await blocks())!;
    expect(empty.input?.action).toBe('ask');
    await plugin.action!('ask', { text: 'Pizza or tacos?' });
    const open = (await blocks())!;
    expect(open.title).toBe('Pizza or tacos?');
    expect(open.footer).toBe('Pizza 0 · Tacos 0 · Closes at 7 PM');
    expect(open.lines.map((l) => l.text)).toEqual(['Jay', 'Mia']);
    expect(PluginChip.parse(await plugin.chip!('chip')).text).toBe('Vote');
    await plugin.action!('vote', { option: 1, by: 'Jay' });
    await plugin.action!('vote', { option: 1, by: 'Mia' });
    const closed = (await blocks())!;
    expect(closed.title).toBe('Tacos wins');
    expect(alerts()[0]!.payload).toMatchObject({ title: 'Tacos wins' });
    await expect(plugin.action!('vote', { option: 0, by: 'Jay' })).rejects.toThrow(/closed/);
  });

  it('closes itself at the set time', async () => {
    const { blocks, plugin, set } = setup(
      () => pollPlugin(),
      { closeAfter: 30 },
      new Date(2026, 10, 21, 17, 0),
    );
    await plugin.action!('ask', { text: 'Park or pool' });
    await plugin.action!('vote', { option: 0, by: 'Jay' });
    set(new Date(2026, 10, 21, 17, 31));
    vi.advanceTimersByTime(31 * 60_000);
    expect((await blocks())!.title).toBe('Park wins');
  });
});

describe('sports', () => {
  const event = (
    state: string,
    home: [string, string, string],
    away: [string, string, string],
    date: string,
  ) => ({
    id: `${home[0]}-${date}`,
    date,
    competitions: [
      {
        date,
        status: {
          type: {
            state,
            shortDetail: state === 'in' ? '4th 2:11' : state === 'post' ? 'Final' : '',
          },
        },
        competitors: [
          {
            homeAway: 'home',
            team: { abbreviation: home[0], shortDisplayName: home[1] },
            score: { displayValue: home[2] },
          },
          {
            homeAway: 'away',
            team: { abbreviation: away[0], shortDisplayName: away[1] },
            score: away[2],
          },
        ],
      },
    ],
  });

  it('reads teams and ESPN games from either score shape', () => {
    expect(parseTeams('nfl/det; eng.1/ars; nope/x')).toEqual([
      { league: 'nfl', team: 'det' },
      { league: 'eng.1', team: 'ars' },
    ]);
    const live = gameFrom(
      event('in', ['DET', 'Lions', '24'], ['GB', 'Packers', '17'], '2026-11-22T18:00Z'),
      'det',
    )!;
    expect(live).toMatchObject({
      text: 'Lions 24, Packers 17',
      short: 'DET 24–17 GB',
      detail: '4th 2:11',
    });
    const next = gameFrom(
      event('pre', ['CHI', 'Bears', '0'], ['DET', 'Lions', '0'], '2026-11-29T18:00Z'),
      'det',
    )!;
    expect(next.text).toBe('Lions at Bears');
    const lost = gameFrom(
      event('post', ['DET', 'Lions', '10'], ['MIN', 'Vikings', '13'], '2026-11-15T18:00Z'),
      'det',
    )!;
    expect(lost.result).toBe('Lost');
    expect(pickGame([lost, next, live], new Date('2026-11-22T19:00Z'))).toBe(live);
    expect(pickGame([lost, next], new Date('2026-11-22T19:00Z'))).toBe(next);
  });

  it('fetches each team from ESPN and sends a banner for a final', async () => {
    const final = event(
      'post',
      ['DET', 'Lions', '31'],
      ['GB', 'Packers', '20'],
      '2026-11-22T18:00:00Z',
    );
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/schedule')
              ? { events: [final] }
              : { team: { abbreviation: 'DET', nextEvent: [] } },
          ),
        ),
    );
    const { blocks, alerts } = setup(
      () => sportsPlugin({ fetch: fetcher as unknown as typeof fetch }),
      { teams: 'nfl/det' },
      new Date('2026-11-22T21:30:00Z'),
    );
    await vi.waitFor(async () => expect((await blocks())!.lines).toHaveLength(1));
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/det',
    );
    const line = (await blocks())!.lines[0]!;
    expect(line).toMatchObject({ text: 'Lions 31, Packers 20', sub: 'Final · Won', tone: 'good' });
    expect(alerts()[0]!.payload).toMatchObject({ title: 'Lions won!' });
  });

  it('shows sample games in mock mode without the network', async () => {
    const { blocks, plugin } = setup(
      () => sportsPlugin({ mock: true }),
      {},
      new Date(2026, 10, 22, 15, 0),
    );
    expect((await blocks())!.lines).toHaveLength(3);
    expect(PluginChip.parse(await plugin.chip!('chip')).text).toBe('DET 24–17 GB');
  });
});

describe('school day', () => {
  const data = (extra: Partial<SchoolData> = {}): SchoolData => ({
    menu: parseMenu('Mon: Pizza; Tue: Tacos; Wed: Soup; Thu: Pasta; Fri: Fish'),
    closures: parseClosures('2026-11-26..2026-11-27 Thanksgiving'),
    rotation: ['A', 'B'],
    rotationStart: '2026-11-16',
    menuByDate: new Map(),
    calendarClosures: new Map(),
    calendarTypes: new Map(),
    ...extra,
  });

  it('rotates A and B over school days only', () => {
    const d = data();
    expect(dayFor(d, new Date(2026, 10, 16))).toMatchObject({ type: 'A', lunch: 'Pizza' });
    expect(dayFor(d, new Date(2026, 10, 20))).toMatchObject({ type: 'A', lunch: 'Fish' });
    expect(dayFor(d, new Date(2026, 10, 23))).toMatchObject({ type: 'B' });
    expect(dayFor(d, new Date(2026, 10, 26))).toMatchObject({
      school: false,
      reason: 'Thanksgiving',
    });
    // Thanksgiving does not count: Monday the 30th follows Wednesday the 25th (B).
    expect(dayFor(d, new Date(2026, 10, 25))).toMatchObject({ type: 'B' });
    expect(dayFor(d, new Date(2026, 10, 30))).toMatchObject({ type: 'A' });
    expect(dayFor(d, new Date(2026, 10, 13))).toMatchObject({ type: 'B' });
  });

  it('leads with tomorrow in the evening and says when there is no school', async () => {
    const { blocks } = setup(
      () => schoolPlugin(),
      { menu: 'Mon: Pizza; Wed: Soup', noSchool: '2026-11-26 Thanksgiving' },
      new Date(2026, 10, 25, 18, 0),
    );
    const card = (await blocks())!;
    expect(card.title).toBe('No school tomorrow');
    expect(card.lines[0]).toMatchObject({ text: 'No school · Thanksgiving', sub: 'Tomorrow' });
    expect((await blocks('ambient'))!.title).toBe('No school tomorrow: Thanksgiving');
  });
});

describe('house status', () => {
  const entity = (
    id: string,
    state: string,
    attrs: Record<string, unknown> = {},
    name = id,
  ): HomeEntity => ({
    id,
    kind: id.startsWith('lock.') ? 'lock' : id.startsWith('cover.') ? 'cover' : 'sensor',
    name,
    state,
    attrs,
  });

  it('picks locks, garage doors, doors, appliances and energy by itself', () => {
    expect(roleOf(entity('lock.front', 'locked'))).toBe('lock');
    expect(roleOf(entity('cover.garage_door', 'open', { device_class: 'garage' }))).toBe('garage');
    expect(roleOf(entity('binary_sensor.back', 'on', { device_class: 'door' }))).toBe('door');
    expect(roleOf(entity('sensor.washer_status', 'Washing'))).toBe('appliance');
    expect(roleOf(entity('sensor.energy_today', '12', { device_class: 'energy' }))).toBe('energy');
    expect(roleOf(entity('sensor.indoor_temperature', '21'))).toBeNull();
    expect(applianceState('Complete')).toBe('done');
    expect(applianceState('spin')).toBe('running');
  });

  it('locks from the card, warns at night and sends a banner when the washer finishes', async () => {
    let entities = [
      entity('lock.front', 'unlocked', {}, 'Front door'),
      entity('sensor.washer', 'running', {}, 'Washer'),
    ];
    const calls: unknown[] = [];
    const home = {
      setup: { enabled: () => true },
      state: async () => ({ areas: [], entities, presence: [] }),
      call: async (req: { entityId: string; service: string }) => {
        calls.push(req);
        entities = entities.map((e) => (e.id === req.entityId ? { ...e, state: 'locked' } : e));
        return { ok: true as const };
      },
    } as unknown as HomeProvider;
    const { blocks, plugin, alerts } = setup(
      () => houseStatusPlugin({ home: () => home }),
      {},
      new Date(2026, 10, 21, 22, 0),
    );
    const card = (await blocks())!;
    expect(card.title).toBe('1 thing open');
    expect(card.lines[0]).toMatchObject({ text: 'Front door', sub: 'Unlocked', tone: 'warn' });
    expect((await blocks('ambient'))!.title).toBe('Front door is unlocked');
    await plugin.action!('call', { entity: 'lock.front', service: 'lock' });
    expect(calls).toEqual([{ entityId: 'lock.front', service: 'lock' }]);
    expect((await blocks())!.title).toBe('All locked up');
    await expect(
      plugin.action!('call', { entity: 'lock.front', service: 'unlock' }),
    ).rejects.toThrow();

    entities = entities.map((e) => (e.id === 'sensor.washer' ? { ...e, state: 'complete' } : e));
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]!.payload).toMatchObject({ title: 'Washer is done' });
  });

  it('asks for Home Assistant when it is not connected', async () => {
    const { blocks, plugin } = setup(() => houseStatusPlugin(), {}, new Date());
    expect((await blocks())!.empty).toMatch(/Connect Home Assistant/);
    expect(plugin.status().state).toBe('not_set_up');
  });
});

describe('habits and plants', () => {
  it('reads how often, and who for', () => {
    expect(parseHabit('Water the plants every 5 days')).toMatchObject({
      name: 'Water the plants',
      every: 5,
      person: null,
    });
    expect(parseHabit('Vitamins daily for Jay')).toMatchObject({ every: 1, person: 'Jay' });
    expect(parseHabit('Filter every 3 months')).toMatchObject({ every: 90 });
    expect(parseHabit('Bins every other week')).toMatchObject({ every: 14 });
    expect(parseHabit('Whenever')).toBeNull();
  });

  it('counts from the last Done, and Undo puts it back', async () => {
    const { blocks, plugin, set } = setup(
      () => habitsPlugin(),
      { habits: 'Water the plants every 3 days' },
      new Date(2026, 10, 21, 9, 0),
    );
    expect((await blocks())!.lines[0]).toMatchObject({ sub: 'Not done yet', tone: 'warn' });
    await plugin.action!('done', { key: 'water-the-plants' });
    expect((await blocks())!.lines[0]!.sub).toBe('Done today · next in 3 days');
    set(new Date(2026, 10, 23, 9, 0));
    expect((await blocks())!.lines[0]!.sub).toBe('In 1 day');
    set(new Date(2026, 10, 26, 9, 0));
    expect((await blocks())!.lines[0]!.sub).toMatch(/^2 days overdue/);
    expect((await blocks('ambient'))!.title).toBe('Water the plants today');
  });
});

describe('question of the day', () => {
  it('has a year of questions, the same all day, and Another one moves on', async () => {
    expect(questionsFor(false).length).toBeGreaterThanOrEqual(365);
    expect(questionsFor(true).every((q) => !q.startsWith('*'))).toBe(true);
    const day = new Date(2026, 10, 21, 8);
    expect(questionFor(day, true)).toBe(questionFor(new Date(2026, 10, 21, 20), true));
    const seen = new Set(
      Array.from({ length: 365 }, (_, i) => questionFor(new Date(2026, 0, 1 + i), true)),
    );
    expect(seen.size).toBe(Math.min(365, questionsFor(true).length));
    const { blocks, plugin } = setup(() => qotdPlugin(), {}, day);
    const first = (await blocks())!.lead;
    await plugin.action!('next', {});
    expect((await blocks())!.lead).not.toBe(first);
    expect(await blocks('ambient')).toBeNull();
  });
});

describe('sky', () => {
  it('puts sunrise and sunset at the right local time', () => {
    // Detroit, 2026-06-21: sunrise about 5:58 AM EDT, sunset about 9:17 PM EDT (09:58 and 01:17 UTC).
    const sun = sunTimes(new Date('2026-06-21T16:00:00Z'), 42.33, -83.05)!;
    expect(Math.abs(sun.rise.getTime() - Date.parse('2026-06-21T09:58:00Z'))).toBeLessThan(
      5 * 60_000,
    );
    expect(Math.abs(sun.set.getTime() - Date.parse('2026-06-22T01:17:00Z'))).toBeLessThan(
      5 * 60_000,
    );
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 78, 15)).toBeNull();
  });

  it('knows the seasons and the moon', () => {
    const [march, june, sept, dec] = seasons(2026).map((d) => d.toISOString().slice(0, 10));
    expect([march, june, sept, dec]).toEqual([
      '2026-03-20',
      '2026-06-21',
      '2026-09-23',
      '2026-12-21',
    ]);
    // A full moon on 2026-11-24.
    expect(moonPhase(new Date('2026-11-24T15:00:00Z'))).toBe('Full moon');
  });

  it('draws a card from the home location', async () => {
    const { blocks } = setup(() => skyPlugin(), {}, new Date(2026, 10, 21, 12));
    const card = (await blocks())!;
    expect(card.lines.map((l) => l.id)).toEqual(['sun', 'moon', 'event']);
    expect(card.lines[0]!.text).toMatch(/^(Sunrise|Sunset) \d/);
  });
});
