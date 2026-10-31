import { weather as weatherFixture } from '@mantel/shared/fixtures';
import { describe, expect, it, vi } from 'vitest';
import {
  QUIPS,
  fillTemplate,
  forecastBrief,
  hashSeed,
  quipContext,
  quipSeed,
  seasonOf,
  selectQuip,
  tempBand,
  timeOfDay,
  writeQuipWithClaude,
  type QuipContext,
} from './quips.js';

const TZ = 'America/Los_Angeles';
// 7:20 am Pacific on Saturday 31 October 2026.
const NOW = new Date('2026-10-31T14:20:00Z');

const base: QuipContext = {
  sky: 'rain',
  band: 'cool',
  time: 'morning',
  season: 'autumn',
  personality: 'friendly',
  wetLater: false,
  weekend: true,
  temp: 54,
  high: 61,
  low: 44,
  feelsLike: 52,
  units: 'imperial',
};

describe('quip library', () => {
  it('has at least 200 lines, each short and well formed', () => {
    expect(QUIPS.length).toBeGreaterThanOrEqual(200);
    for (const line of QUIPS) {
      expect(line.text.length).toBeLessThanOrEqual(150);
      expect(line.text.trim()).toBe(line.text);
      // Every template token is one we fill.
      for (const token of line.text.match(/\{[a-z]+\}/g) ?? [])
        expect(['{temp}', '{high}', '{low}', '{feels}', '{season}']).toContain(token);
    }
    const texts = QUIPS.map((l) => l.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('covers every sky, band, time, season and both voices', () => {
    const skies = [
      'clear',
      'partly',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'snow',
      'sleet',
      'storm',
      'wind',
    ];
    for (const sky of skies) expect(QUIPS.some((l) => l.sky?.includes(sky as never))).toBe(true);
    for (const band of ['freezing', 'cold', 'cool', 'mild', 'warm', 'hot'])
      expect(QUIPS.some((l) => l.band?.includes(band as never))).toBe(true);
    for (const time of ['morning', 'midday', 'afternoon', 'evening', 'night'])
      expect(QUIPS.some((l) => l.time?.includes(time as never))).toBe(true);
    for (const season of ['winter', 'spring', 'summer', 'autumn'])
      expect(QUIPS.some((l) => l.season?.includes(season as never))).toBe(true);
    expect(QUIPS.filter((l) => l.personality === 'friendly').length).toBeGreaterThan(60);
    expect(QUIPS.filter((l) => l.personality === 'snarky').length).toBeGreaterThan(60);
  });
});

describe('quip selection', () => {
  it('bands temperature, time and season', () => {
    expect([20, 40, 55, 70, 80, 95].map((t) => tempBand(t, 'imperial'))).toEqual([
      'freezing',
      'cold',
      'cool',
      'mild',
      'warm',
      'hot',
    ]);
    expect(tempBand(-5, 'metric')).toBe('freezing');
    expect(tempBand(30, 'metric')).toBe('warm');
    expect([6, 12, 16, 19, 23, 2].map(timeOfDay)).toEqual([
      'morning',
      'midday',
      'afternoon',
      'evening',
      'night',
      'night',
    ]);
    expect(seasonOf(9)).toBe('autumn');
    expect(seasonOf(9, -33)).toBe('spring');
    expect(seasonOf(0)).toBe('winter');
  });

  it('builds the context from a snapshot', () => {
    const ctx = quipContext(
      { ...weatherFixture(new Date(2026, 9, 31, 7, 20)), timezone: TZ },
      NOW,
      TZ,
      'snarky',
    );
    expect(ctx).toMatchObject({
      sky: 'partly',
      band: 'cool',
      time: 'morning',
      season: 'autumn',
      personality: 'snarky',
      weekend: true,
      temp: 54,
      high: 61,
      low: 44,
    });
    // The fixture rains in the afternoon.
    expect(ctx.wetLater).toBe(true);
  });

  it('prefers the most specific lines and respects the voice', () => {
    const picked = new Set<string>();
    for (let i = 0; i < 40; i++) picked.add(selectQuip(base, `seed-${i}`));
    // Every pick is a rain line (specific beats generic) and never a snarky one.
    for (const text of picked) {
      const line = QUIPS.find((l) => fillTemplate(l.text, base) === text)!;
      expect(line).toBeDefined();
      expect(line.personality).not.toBe('snarky');
      expect(line.sky).toContain('rain');
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  it('is deterministic for a seed and rotates with it', () => {
    expect(selectQuip(base, 'a')).toBe(selectQuip(base, 'a'));
    const all = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => selectQuip(base, s)));
    expect(all.size).toBeGreaterThan(1);
    expect(hashSeed('x')).toBe(hashSeed('x'));
    expect(hashSeed('x')).not.toBe(hashSeed('y'));
    const seed = quipSeed(base, NOW, TZ);
    expect(seed).toBe('2026-10-31:2:rain:cool');
  });

  it('fills the temperature tokens', () => {
    expect(fillTemplate('{temp} now, {high} later, {low} tonight, feels {feels}', base)).toBe(
      '54° now, 61° later, 44° tonight, feels 52°',
    );
    const text = selectQuip({ ...base, sky: 'clear', band: 'hot', time: 'night' }, 's');
    expect(text).not.toMatch(/\{/);
  });

  it('never fails to find a line, whatever the context', () => {
    const skies = [
      'clear',
      'partly',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'snow',
      'sleet',
      'storm',
      'wind',
    ] as const;
    const bands = ['freezing', 'cold', 'cool', 'mild', 'warm', 'hot'] as const;
    const times = ['morning', 'midday', 'afternoon', 'evening', 'night'] as const;
    for (const sky of skies)
      for (const band of bands)
        for (const time of times)
          for (const personality of ['friendly', 'snarky'] as const) {
            const text = selectQuip({ ...base, sky, band, time, personality }, 'z');
            expect(text.length).toBeGreaterThan(10);
          }
  });
});

describe('Claude quips', () => {
  const snapshot = { ...weatherFixture(new Date(2026, 9, 31, 7, 20)), timezone: TZ };
  const events = [
    {
      id: 'e1',
      calendarId: 'c',
      title: 'Soccer practice',
      start: '2026-10-31T16:00:00-07:00',
      end: '2026-10-31T17:00:00-07:00',
      allDay: false,
      personIds: [],
      color: '#000',
      countdown: false,
    },
  ];

  it('briefs the model with the forecast and the day', () => {
    const brief = forecastBrief(snapshot, events, new Date(2026, 9, 31, 7, 20));
    expect(brief).toContain('Now: 54°F');
    expect(brief).toContain('Today: high 61°');
    expect(brief).toContain('Soccer practice at 16:00');
  });

  it('asks Haiku for one line and cleans it up', async () => {
    const create = vi.fn(async () => ({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '"Rain by soccer time, so the good umbrella goes in the bag."' },
      ],
    }));
    const text = await writeQuipWithClaude({
      apiKey: 'k',
      weather: snapshot,
      events,
      personality: 'friendly',
      now: NOW,
      timeZone: TZ,
      client: { messages: { create } } as never,
    });
    expect(text).toBe('Rain by soccer time, so the good umbrella goes in the bag.');
    const req = create.mock.calls[0]![0 as never] as unknown as { model: string; system: string };
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.system).toContain('favourite aunt');
  });

  it('falls back on a refusal, an empty answer or an error', async () => {
    const args = {
      apiKey: 'k',
      weather: snapshot,
      events,
      personality: 'snarky' as const,
      now: NOW,
      timeZone: TZ,
    };
    expect(
      await writeQuipWithClaude({
        ...args,
        client: {
          messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) },
        } as never,
      }),
    ).toBeNull();
    expect(
      await writeQuipWithClaude({
        ...args,
        client: {
          messages: {
            create: async () => ({
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: 'Hi' }],
            }),
          },
        } as never,
      }),
    ).toBeNull();
    expect(
      await writeQuipWithClaude({
        ...args,
        client: {
          messages: {
            create: async () => {
              throw new Error('401');
            },
          },
        } as never,
      }),
    ).toBeNull();
  });
});
