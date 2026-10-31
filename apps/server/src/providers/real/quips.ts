/**
 * Weather quips: one line a day about the weather, in a friendly or a snarky voice.
 *
 * The library below is hand-written and keyed by sky, temperature band, time of day, season and
 * personality. `selectQuip` picks the most specific lines that fit and rotates through them a
 * few times a day. With a Claude API key, `writeQuipWithClaude` writes one fresh line per day
 * from the forecast and the day's events; anything going wrong falls back to the library.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CalendarEvent, QuipPersonality, WeatherSnapshotExtended } from '@mantel/shared';
import { log } from '../../log.js';
import { zoned } from './weather-time.js';

export type Sky =
  'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'sleet' | 'storm' | 'wind';
export type TempBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type Voice = Exclude<QuipPersonality, 'off'>;

export interface QuipContext {
  sky: Sky;
  band: TempBand;
  time: TimeOfDay;
  season: Season;
  personality: Voice;
  /** True when rain or snow is expected later today but is not falling now. */
  wetLater: boolean;
  /** True when the day is a weekend. */
  weekend: boolean;
  temp: number;
  high: number;
  low: number;
  feelsLike: number;
  units: 'imperial' | 'metric';
}

export interface QuipLine {
  text: string;
  /** Each key, when given, must include the context's value. Absent keys match anything. */
  sky?: Sky[];
  band?: TempBand[];
  time?: TimeOfDay[];
  season?: Season[];
  wetLater?: boolean;
  weekend?: boolean;
  personality: Voice | 'any';
}

/* ---------- context ---------- */

/** Fahrenheit bands; metric snapshots are converted first. */
export function tempBand(temp: number, units: 'imperial' | 'metric'): TempBand {
  const f = units === 'metric' ? temp * 1.8 + 32 : temp;
  if (f < 32) return 'freezing';
  if (f < 50) return 'cold';
  if (f < 65) return 'cool';
  if (f < 78) return 'mild';
  if (f < 90) return 'warm';
  return 'hot';
}

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'midday';
  if (hour >= 15 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/** Meteorological seasons; flipped south of the equator. */
export function seasonOf(month: number, latitude = 45): Season {
  const north: Season[] = [
    'winter',
    'winter',
    'spring',
    'spring',
    'spring',
    'summer',
    'summer',
    'summer',
    'autumn',
    'autumn',
    'autumn',
    'winter',
  ];
  const s = north[month]!;
  if (latitude >= 0) return s;
  const flip: Record<Season, Season> = {
    winter: 'summer',
    summer: 'winter',
    spring: 'autumn',
    autumn: 'spring',
  };
  return flip[s];
}

const WET: Sky[] = ['drizzle', 'rain', 'snow', 'sleet', 'storm'];

export function quipContext(
  w: WeatherSnapshotExtended,
  now: Date,
  timeZone: string,
  personality: Voice,
): QuipContext {
  const z = zoned(now, timeZone);
  const today = w.daily[0];
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const wetNow = WET.includes(w.current.condition);
  const wetLater =
    !wetNow &&
    w.hourly.some(
      (h) => new Date(h.time) <= endOfDay && WET.includes(h.condition) && h.precipChance >= 40,
    );
  return {
    sky: w.current.condition,
    band: tempBand(w.current.temp, w.units),
    time: timeOfDay(z.hour),
    season: seasonOf(z.month - 1, w.coordinates?.latitude),
    personality,
    wetLater,
    weekend: z.weekday === 0 || z.weekday === 6,
    temp: Math.round(w.current.temp),
    high: Math.round(today?.high ?? w.current.temp),
    low: Math.round(today?.low ?? w.current.temp),
    feelsLike: Math.round(w.current.feelsLike),
    units: w.units,
  };
}

/* ---------- selection ---------- */

function fits(line: QuipLine, ctx: QuipContext): number | null {
  if (line.personality !== 'any' && line.personality !== ctx.personality) return null;
  let score = line.personality === 'any' ? 0 : 1;
  const check = <K extends 'sky' | 'band' | 'time' | 'season'>(key: K) => {
    const want = line[key] as QuipContext[K][] | undefined;
    if (!want) return true;
    if (!want.includes(ctx[key])) return false;
    score += key === 'sky' ? 3 : 2;
    return true;
  };
  if (!check('sky') || !check('band') || !check('time') || !check('season')) return null;
  if (line.wetLater !== undefined) {
    if (line.wetLater !== ctx.wetLater) return null;
    score += 2;
  }
  if (line.weekend !== undefined) {
    if (line.weekend !== ctx.weekend) return null;
    score += 1;
  }
  return score;
}

/** Deterministic 32-bit hash, so the same seed picks the same line. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fillTemplate(text: string, ctx: QuipContext): string {
  const unit = ctx.units === 'imperial' ? '°' : '°';
  return text
    .replaceAll('{temp}', `${ctx.temp}${unit}`)
    .replaceAll('{high}', `${ctx.high}${unit}`)
    .replaceAll('{low}', `${ctx.low}${unit}`)
    .replaceAll('{feels}', `${ctx.feelsLike}${unit}`);
}

/**
 * The best-fitting lines for the context, rotated by `seed`. The most specific tier always
 * wins; if it holds fewer than three lines the next tier joins so the display is not stuck on one.
 */
export function selectQuip(
  ctx: QuipContext,
  seed: string,
  lines: readonly QuipLine[] = QUIPS,
): string {
  let scored = lines
    .map((line) => ({ line, score: fits(line, ctx) }))
    .filter((x): x is { line: QuipLine; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return fillTemplate(FALLBACK[ctx.personality], ctx);
  // Lines written for this sky (or for rain coming later) always beat lines about the time of
  // day or the season, however many of those keys they match.
  const aboutSky = scored.filter((x) => x.line.sky || x.line.wetLater === true);
  if (aboutSky.length) scored = aboutSky;
  let pool = scored.filter((x) => x.score === scored[0]!.score);
  if (pool.length < 3) {
    const next = scored.find((x) => x.score < scored[0]!.score)?.score;
    if (next !== undefined) pool = scored.filter((x) => x.score >= next);
  }
  const pick = pool[hashSeed(seed) % pool.length]!;
  return fillTemplate(pick.line.text, ctx);
}

/** Changes every three hours and with the sky, so a day sees a few lines but not a new one every refresh. */
export function quipSeed(ctx: QuipContext, now: Date, timeZone: string): string {
  const z = zoned(now, timeZone);
  return `${z.year}-${z.month}-${z.day}:${Math.floor(z.hour / 3)}:${ctx.sky}:${ctx.band}`;
}

const FALLBACK: Record<Voice, string> = {
  friendly: 'Weather is happening out there. Dress for {temp} and have a good one.',
  snarky: "It's {temp} outside. That's the whole report. Go live your life.",
};

/* ---------- Claude ---------- */

export const QUIP_MODEL = 'claude-haiku-5-5';

const VOICE: Record<Voice, string> = {
  friendly:
    'Warm, witty and kind, like a favourite aunt who reads the forecast. Gentle humour, never sarcasm.',
  snarky:
    'Dry, deadpan and a little exasperated, like a weather app that has seen things. Teasing but never mean, never crude, and always family-safe (children read this).',
};

export interface ClaudeQuipInput {
  apiKey: string;
  weather: WeatherSnapshotExtended;
  events: CalendarEvent[];
  personality: Voice;
  now: Date;
  timeZone: string;
  /** Test seam. */
  client?: Pick<Anthropic, 'messages'>;
}

/** Summary of the day Claude writes from; kept short so a day costs a fraction of a cent. */
export function forecastBrief(w: WeatherSnapshotExtended, events: CalendarEvent[], now: Date) {
  const today = w.daily[0];
  const unit = w.units === 'imperial' ? 'F' : 'C';
  const wind = w.units === 'imperial' ? 'mph' : 'km/h';
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const hours = w.hourly
    .filter((h) => new Date(h.time) <= endOfDay)
    .map((h) => `${new Date(h.time).getHours()}h ${h.temp}° ${h.condition} ${h.precipChance}%`)
    .join(', ');
  const lines = [
    `Place: ${w.locationName}. Now: ${w.current.temp}°${unit}, ${w.current.summary.toLowerCase()}, feels like ${w.current.feelsLike}°, wind ${w.current.windSpeed} ${wind}, humidity ${w.current.humidity}%.`,
    today
      ? `Today: high ${today.high}°, low ${today.low}°, ${today.summary?.toLowerCase() ?? today.condition}, rain chance ${today.precipChance}%. Sunrise ${today.sunrise.slice(11, 16)}, sunset ${today.sunset.slice(11, 16)}.`
      : '',
    hours ? `Rest of today by hour: ${hours}.` : '',
    w.daily[1]
      ? `Tomorrow: high ${w.daily[1].high}°, low ${w.daily[1].low}°, ${w.daily[1].summary?.toLowerCase() ?? w.daily[1].condition}.`
      : '',
    w.alerts.length ? `Alerts: ${w.alerts.map((a) => a.event).join('; ')}.` : '',
    events.length
      ? `On the family calendar today: ${events
          .slice(0, 8)
          .map((e) => `${e.title}${e.allDay ? ' (all day)' : ` at ${e.start.slice(11, 16)}`}`)
          .join('; ')}.`
      : 'Nothing on the family calendar today.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** One line from Claude, or null when the call fails or the answer is unusable. */
export async function writeQuipWithClaude(input: ClaudeQuipInput): Promise<string | null> {
  const client =
    input.client ?? new Anthropic({ apiKey: input.apiKey, maxRetries: 1, timeout: 20_000 });
  try {
    const response = await client.messages.create({
      model: QUIP_MODEL,
      max_tokens: 256,
      output_config: { effort: 'low' },
      system: [
        'You write the one-line weather remark on a family wall display in the kitchen.',
        `Voice: ${VOICE[input.personality]}`,
        'Rules: one sentence, at most 140 characters, plain text, no emoji, no hashtags, no quotation marks.',
        'Use the forecast and, when it fits, one thing from the calendar (an umbrella for the soccer game, a coat for the early practice).',
        'Never invent weather or events that are not in the brief. Say nothing about the family beyond the listed events.',
        'Answer with the sentence only.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: forecastBrief(input.weather, input.events, input.now),
        },
      ],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
    if (text.length < 8 || text.length > 200) return null;
    return text;
  } catch (err) {
    log.warn('quips: Claude unavailable, using the library', { err: String(err) });
    return null;
  }
}

/* ---------- the library ---------- */

const F = 'friendly' as const;
const S = 'snarky' as const;

const q = (
  text: string,
  personality: Voice | 'any',
  rest: Omit<QuipLine, 'text' | 'personality'> = {},
) => ({ text, personality, ...rest }) satisfies QuipLine;

export const QUIPS: readonly QuipLine[] = [
  /* --- clear skies --- */
  q('Blue sky, no notes. Go stand in it for a minute.', F, { sky: ['clear'] }),
  q('Clear and bright. The windows are judging you for not opening them.', S, { sky: ['clear'] }),
  q('Not a cloud in sight. Sunglasses are a reasonable life choice today.', F, {
    sky: ['clear'],
    time: ['morning', 'midday'],
  }),
  q('The sun showed up on time. One of us had to.', S, { sky: ['clear'], time: ['morning'] }),
  q('Sunny and {temp}. Lunch outside is practically mandatory.', F, {
    sky: ['clear'],
    time: ['midday'],
    band: ['mild', 'warm'],
  }),
  q('Peak sun. Whatever you are putting off indoors will still be there after a walk.', S, {
    sky: ['clear'],
    time: ['midday'],
  }),
  q('Golden hour is coming. Catch the sunset if you can.', F, {
    sky: ['clear'],
    time: ['afternoon'],
  }),
  q('Clear evening ahead. The stars are doing a free show; attendance is optional.', F, {
    sky: ['clear'],
    time: ['evening', 'night'],
  }),
  q(
    'Clear skies tonight, which means it gets cold fast. Grab the blanket now and save the trip.',
    S,
    { sky: ['clear'], time: ['evening', 'night'], band: ['cold', 'cool'] },
  ),
  q('Clear and {temp}. The kind of day screens were invented to distract you from.', S, {
    sky: ['clear'],
    band: ['mild', 'warm'],
  }),
  q('Bright, crisp and {temp}. Jacket weather with a side of sunshine.', F, {
    sky: ['clear'],
    band: ['cool'],
  }),
  q('Sunny but {temp}. The sun is decorative today, not functional.', S, {
    sky: ['clear'],
    band: ['cold', 'freezing'],
  }),
  q('Clear and freezing. Beautiful from the window, a betrayal on the doorstep.', S, {
    sky: ['clear'],
    band: ['freezing'],
  }),
  q('Cold and clear. Bundle up; the view is worth it.', F, {
    sky: ['clear'],
    band: ['freezing', 'cold'],
  }),
  q('Sunshine and {temp}. Shorts weather for the brave, patio weather for everyone.', F, {
    sky: ['clear'],
    band: ['warm'],
  }),
  q('Hot and cloudless. The sun is not asking for permission.', S, {
    sky: ['clear'],
    band: ['hot'],
  }),
  q('{temp} and sunny. Water, hat, shade, repeat.', F, { sky: ['clear'], band: ['hot'] }),
  q('Clear skies on a weekend. Coincidence? The forecast would like some credit.', S, {
    sky: ['clear'],
    weekend: true,
  }),
  q('A sunny weekend. Whatever the plan was, it just got better.', F, {
    sky: ['clear'],
    weekend: true,
  }),
  q('Clear all day, and a work day. Nature has a sense of humour.', S, {
    sky: ['clear'],
    weekend: false,
    time: ['morning', 'midday'],
  }),

  /* --- partly cloudy --- */
  q('Sun and clouds taking turns. Both are welcome.', F, { sky: ['partly'] }),
  q('Partly cloudy, which is weather for people who cannot commit.', S, { sky: ['partly'] }),
  q('A few clouds for texture. Still a good day to be outside.', F, { sky: ['partly'] }),
  q("The sky is doing that thing where it can't decide. Relatable.", S, { sky: ['partly'] }),
  q('Partly cloudy and {temp}. Light jacket, then regret the jacket, then want it again.', S, {
    sky: ['partly'],
    band: ['cool'],
  }),
  q('Clouds drifting through a mild {temp}. Easy weather. Enjoy it.', F, {
    sky: ['partly'],
    band: ['mild'],
  }),
  q('Sun, clouds, and {temp}. The forecast equivalent of a shrug.', S, {
    sky: ['partly'],
    band: ['mild', 'warm'],
  }),
  q('Partly cloudy morning. Coffee first, decisions later.', F, {
    sky: ['partly'],
    time: ['morning'],
  }),
  q('Mixed skies this morning, which is a polite way of saying nobody knows.', S, {
    sky: ['partly'],
    time: ['morning'],
  }),
  q('Clouds breaking up this afternoon. The sun gets the last word.', F, {
    sky: ['partly'],
    time: ['afternoon'],
  }),
  q('Patchy clouds tonight. Moon viewing available between gaps.', F, {
    sky: ['partly'],
    time: ['evening', 'night'],
  }),
  q('Partly cloudy and warm. The clouds are just here for shade.', F, {
    sky: ['partly'],
    band: ['warm', 'hot'],
  }),
  q('Cold with a scattering of clouds. The sun is trying. So should you.', S, {
    sky: ['partly'],
    band: ['cold', 'freezing'],
  }),

  /* --- cloudy --- */
  q('Grey and soft. A good day for soup and a long book.', F, { sky: ['cloudy'] }),
  q('Overcast. The sky has gone with the default background.', S, { sky: ['cloudy'] }),
  q('Cloud cover all day. No sunscreen, no sunglasses, no excuses.', S, { sky: ['cloudy'] }),
  q('A lid of cloud over everything. Cosy, if you let it be.', F, { sky: ['cloudy'] }),
  q('Cloudy and {temp}. Sweater weather with the lights on.', F, {
    sky: ['cloudy'],
    band: ['cool', 'cold'],
  }),
  q('Grey morning. The sun is in there somewhere, probably also hitting snooze.', S, {
    sky: ['cloudy'],
    time: ['morning'],
  }),
  q('A cloudy start. Tea, toast, and no rush about anything.', F, {
    sky: ['cloudy'],
    time: ['morning'],
  }),
  q('Cloudy at midday, which at least makes the screens easier to read.', S, {
    sky: ['cloudy'],
    time: ['midday'],
  }),
  q('Overcast afternoon. The light is flat but the air is kind.', F, {
    sky: ['cloudy'],
    time: ['afternoon'],
  }),
  q('Clouds tonight, so it stays milder than it looks. Small mercies.', F, {
    sky: ['cloudy'],
    time: ['evening', 'night'],
  }),
  q('Cloudy and warm. Humid enough to make the hair interesting.', S, {
    sky: ['cloudy'],
    band: ['warm', 'hot'],
  }),
  q('Grey and cold. Even the clouds look like they want to go home.', S, {
    sky: ['cloudy'],
    band: ['cold', 'freezing'],
  }),
  q('Overcast but mild. Perfect for a walk with no sweating and no shivering.', F, {
    sky: ['cloudy'],
    band: ['mild'],
  }),
  q('A cloudy weekend. The couch has been expecting you.', S, { sky: ['cloudy'], weekend: true }),

  /* --- fog --- */
  q('Fog this morning. Headlights on, patience up.', F, { sky: ['fog'], time: ['morning'] }),
  q('Fog. The world has been set to low resolution.', S, { sky: ['fog'] }),
  q('Foggy out. Everything looks mysterious, including the bins.', S, { sky: ['fog'] }),
  q('A soft fog over everything. Drive gently and enjoy the hush.', F, { sky: ['fog'] }),
  q('Fog should lift as the day warms. Until then, the neighbourhood is a rumour.', S, {
    sky: ['fog'],
    time: ['morning', 'midday'],
  }),
  q('Fog at night. The street lights are doing their best impression of a film set.', F, {
    sky: ['fog'],
    time: ['evening', 'night'],
  }),
  q('Freezing fog. Pretty on the trees, treacherous on the steps.', F, {
    sky: ['fog'],
    band: ['freezing'],
  }),

  /* --- drizzle --- */
  q('Drizzle. Not enough to cancel anything, just enough to be annoying.', S, { sky: ['drizzle'] }),
  q('A light drizzle. The gentlest possible way for a day to be damp.', F, { sky: ['drizzle'] }),
  q('Drizzling out there. Hoods up, spirits up.', F, { sky: ['drizzle'] }),
  q('Mist that is technically rain. The umbrella debate is yours.', S, { sky: ['drizzle'] }),
  q('Drizzle and {temp}. The air is wearing a damp cardigan.', S, {
    sky: ['drizzle'],
    band: ['cool', 'cold'],
  }),
  q('A drizzly morning. Good hair day for exactly no one, so relax about it.', S, {
    sky: ['drizzle'],
    time: ['morning'],
  }),
  q('Drizzle this evening. Streetlights and puddles, very atmospheric.', F, {
    sky: ['drizzle'],
    time: ['evening', 'night'],
  }),

  /* --- rain --- */
  q('Rain today. The garden is thrilled; the shoes are not.', F, { sky: ['rain'] }),
  q("It's raining. The umbrella is by the door, where you left it last time, hopefully.", S, {
    sky: ['rain'],
  }),
  q('Steady rain. A fine excuse for pancakes and a board game.', F, { sky: ['rain'] }),
  q('Rain. The sky is finally getting around to that thing it kept threatening.', S, {
    sky: ['rain'],
  }),
  q('Rainy and {temp}. Waterproof layers over warm layers, in that order.', F, {
    sky: ['rain'],
    band: ['cold', 'cool'],
  }),
  q('Cold rain, the least popular rain. Dress like you mean it.', S, {
    sky: ['rain'],
    band: ['cold', 'freezing'],
  }),
  q('Warm rain. The kind kids run around in while adults pretend to disapprove.', F, {
    sky: ['rain'],
    band: ['warm', 'hot'],
  }),
  q('Rain this morning. Leave five minutes early and arrive only slightly damp.', F, {
    sky: ['rain'],
    time: ['morning'],
  }),
  q('Raining at breakfast. Toast tastes the same, honestly.', S, {
    sky: ['rain'],
    time: ['morning'],
  }),
  q('Rain through lunch. Eat in, or embrace the soggy sandwich.', S, {
    sky: ['rain'],
    time: ['midday'],
  }),
  q('Rainy afternoon. The windows have never looked more interesting.', F, {
    sky: ['rain'],
    time: ['afternoon'],
  }),
  q('Rain this evening. Good night for a film and an early blanket.', F, {
    sky: ['rain'],
    time: ['evening'],
  }),
  q('Rain overnight, which is the correct time for rain. Well done, sky.', S, {
    sky: ['rain'],
    time: ['night'],
  }),
  q('A rainy weekend. Puzzles, baking, and staring thoughtfully out of windows.', F, {
    sky: ['rain'],
    weekend: true,
  }),
  q('Rain on the weekend. The forecast would like to apologise, but it will not.', S, {
    sky: ['rain'],
    weekend: true,
  }),
  q('Rain on a work day, so at least no plans were ruined. Perspective.', S, {
    sky: ['rain'],
    weekend: false,
  }),
  q('Spring rain. Everything green is quietly celebrating.', F, {
    sky: ['rain'],
    season: ['spring'],
  }),
  q('Autumn rain. Leaves down, puddles up, boots on.', F, { sky: ['rain'], season: ['autumn'] }),
  q('Summer rain, which at least has the decency to be warm.', S, {
    sky: ['rain'],
    season: ['summer'],
  }),
  q('Winter rain. Could have been snow. Chose violence instead.', S, {
    sky: ['rain'],
    season: ['winter'],
  }),

  /* --- snow --- */
  q('Snow! Mittens, hot chocolate, and someone needs to find the sled.', F, { sky: ['snow'] }),
  q('Snowing. Pretty for the first hour, a chore after that.', S, { sky: ['snow'] }),
  q("It's snowing. The driveway has entered the chat.", S, { sky: ['snow'] }),
  q('Snowflakes drifting down. Watch them for a minute before the day starts.', F, {
    sky: ['snow'],
  }),
  q('Snow this morning. Allow extra time for everything, including finding the other glove.', F, {
    sky: ['snow'],
    time: ['morning'],
  }),
  q('Snow overnight. Tomorrow starts with a shovel or a snowman, your call.', S, {
    sky: ['snow'],
    time: ['evening', 'night'],
  }),
  q('Snow on a weekend. This is the good kind. Go play.', F, { sky: ['snow'], weekend: true }),
  q('Snow on a school day. Watch the inbox and keep hopes modest.', S, {
    sky: ['snow'],
    weekend: false,
    time: ['morning'],
  }),
  q('Snow in {season}. Nobody ordered this, but here we are.', S, {
    sky: ['snow'],
    season: ['spring', 'autumn'],
  }),
  q('Snow and {temp}. Layers, then more layers, then a scarf over the layers.', F, {
    sky: ['snow'],
    band: ['freezing'],
  }),

  /* --- sleet and freezing rain --- */
  q('Sleet. Rain that has given up on being pleasant.', S, { sky: ['sleet'] }),
  q('Icy rain today. Mind the steps and take the slow route.', F, { sky: ['sleet'] }),
  q('Freezing rain, the worst of both weathers. Stay in if you can.', S, { sky: ['sleet'] }),
  q('Sleet and {temp}. Everything outside is slightly glazed, like a pastry nobody wants.', S, {
    sky: ['sleet'],
    band: ['freezing', 'cold'],
  }),
  q('Sleety morning. Warm hands on the wheel and extra care at the corners.', F, {
    sky: ['sleet'],
    time: ['morning'],
  }),

  /* --- storms --- */
  q('Thunderstorms around. Count the seconds between flash and rumble; the kids will love it.', F, {
    sky: ['storm'],
  }),
  q('Storms. The sky is having a moment. Give it some space.', S, { sky: ['storm'] }),
  q('Thunder in the forecast. Unplug the fancy things and enjoy the show from inside.', F, {
    sky: ['storm'],
  }),
  q('Stormy. A fine day to discover which gutters are blocked.', S, { sky: ['storm'] }),
  q('Afternoon storms. Get the errands done early and the popcorn ready late.', F, {
    sky: ['storm'],
    time: ['morning', 'midday'],
  }),
  q('Storms this evening. Free light show, slightly loud, no refunds.', S, {
    sky: ['storm'],
    time: ['evening', 'night'],
  }),
  q('Summer storms. Hot, then loud, then steamy. The full package.', S, {
    sky: ['storm'],
    season: ['summer'],
  }),

  /* --- wind --- */
  q('Windy. Hold onto hats, small dogs and any opinions you were about to share.', S, {
    sky: ['wind'],
  }),
  q('A big wind today. Kites yes, umbrellas no.', F, { sky: ['wind'] }),
  q('Blustery out. The bins are planning a trip.', S, { sky: ['wind'] }),
  q('Windy and bright. Fresh air delivered straight to the face, free of charge.', F, {
    sky: ['wind'],
  }),
  q('Wind and {temp}. The number lies; it feels colder. Scarf up.', S, {
    sky: ['wind'],
    band: ['cold', 'cool', 'freezing'],
  }),
  q('Warm wind today. Like a hairdryer with ambitions.', S, {
    sky: ['wind'],
    band: ['warm', 'hot'],
  }),
  q('Gusty morning. Hair will do what hair wants. Let it.', F, {
    sky: ['wind'],
    time: ['morning'],
  }),
  q('Windy night. Every creak is the house, not a ghost. Probably.', S, {
    sky: ['wind'],
    time: ['night', 'evening'],
  }),
  q('Autumn wind. The leaves are leaving, dramatically.', F, { sky: ['wind'], season: ['autumn'] }),

  /* --- rain or snow later today --- */
  q('Dry now, rain later. Whatever needs doing outside, do it before lunch.', F, {
    wetLater: true,
    time: ['morning'],
  }),
  q('Dry for now. The rain is on its way, moving at the speed of a reluctant teenager.', S, {
    wetLater: true,
    time: ['morning', 'midday'],
  }),
  q('Rain arriving later. Bring a jacket you will be glad about around dinner.', F, {
    wetLater: true,
  }),
  q('Enjoy the dry spell; the sky has plans for this afternoon.', S, {
    wetLater: true,
    time: ['morning', 'midday'],
  }),
  q('Wet weather later. Washing in now, hero status secured.', S, {
    wetLater: true,
    time: ['morning', 'midday'],
  }),
  q('Showers moving in this evening. Perfect timing for being inside anyway.', F, {
    wetLater: true,
    time: ['afternoon', 'evening'],
  }),
  q('Rain tonight, so the garden gets watered without anyone lifting a hose.', F, {
    wetLater: true,
    time: ['evening'],
  }),
  q('Something wet is coming later. The umbrella would like to be remembered this time.', S, {
    wetLater: true,
  }),
  q('Clear for now, {high} at the top, rain to finish. A full three-act day.', F, {
    wetLater: true,
    sky: ['clear', 'partly'],
  }),
  q('Sun now, rain later. The forecast is running a two-for-one.', S, {
    wetLater: true,
    sky: ['clear', 'partly'],
  }),

  /* --- temperature, any sky --- */
  q('Freezing out there. The car needs a minute and so do you.', F, {
    band: ['freezing'],
    time: ['morning'],
  }),
  q('{temp}. The air hurts. Put on the big coat, not the stylish one.', S, { band: ['freezing'] }),
  q('Below freezing. Hats are not a fashion choice today, they are survival.', S, {
    band: ['freezing'],
  }),
  q('Very cold and very still. Watch your breath cloud up and feel smug about the thermostat.', F, {
    band: ['freezing'],
  }),
  q('Freezing tonight. Pipes, plants and pets, in that order of worry.', F, {
    band: ['freezing'],
    time: ['evening', 'night'],
  }),
  q('Cold this morning, {temp} and climbing slowly. Coat now, carry it later.', F, {
    band: ['cold'],
    time: ['morning'],
  }),
  q('{temp} and cold. The kind of weather that makes a kettle feel like a friend.', F, {
    band: ['cold'],
  }),
  q('Cold. Not dramatic cold, just enough that the gloves pay for themselves.', S, {
    band: ['cold'],
  }),
  q('A chilly {temp}. Perfect for a brisk walk and a smug return.', S, { band: ['cold'] }),
  q('Cold night ahead, down to {low}. Extra blanket territory.', F, {
    band: ['cold', 'cool'],
    time: ['evening', 'night'],
  }),
  q('Cool and {temp}. Jacket weather, the best weather.', F, { band: ['cool'] }),
  q('{temp} and cool. Sweater on, windows cracked, a very reasonable day.', F, { band: ['cool'] }),
  q('Cool out. Not cold, not warm, just enough to make choosing a coat a small drama.', S, {
    band: ['cool'],
  }),
  q('Mild and {temp}. The thermostat can take the day off.', F, { band: ['mild'] }),
  q('{temp}. Weather so agreeable it is almost suspicious.', S, { band: ['mild'] }),
  q('Mild and easy. No complaints available for today.', S, { band: ['mild'] }),
  q('A mild evening, still {temp}. Sit outside a while longer.', F, {
    band: ['mild'],
    time: ['evening'],
  }),
  q('Warm and {temp}. Iced drinks are now a food group.', F, { band: ['warm'] }),
  q('{temp} and warm. The ice cream rule is in effect; you know the rule.', S, { band: ['warm'] }),
  q('Warm day, {high} at the top. Shade is the move after lunch.', F, {
    band: ['warm'],
    time: ['morning', 'midday'],
  }),
  q('Warm evening. The good kind of sitting-outside-until-dark weather.', F, {
    band: ['warm'],
    time: ['evening'],
  }),
  q('Hot. {temp} and the pavement is thinking about melting.', S, { band: ['hot'] }),
  q('{temp} and climbing. Hydrate like it is your job.', F, { band: ['hot'] }),
  q('Hot enough that the dog is reconsidering the walk. Early or late, not midday.', S, {
    band: ['hot'],
    time: ['midday', 'afternoon'],
  }),
  q('Hot night. Fans on, windows strategic, sleep eventual.', S, {
    band: ['hot'],
    time: ['evening', 'night'],
  }),
  q(
    'Already warm this morning, headed for {high}. Sunscreen before the day gets away from you.',
    F,
    { band: ['warm', 'hot'], time: ['morning'] },
  ),
  q('Feels like {feels} out there, whatever the thermometer says. Dress for the feel.', F, {
    band: ['freezing', 'cold'],
  }),

  /* --- time of day, any sky --- */
  q('Good morning. {temp} now, {high} later. You have got this.', F, { time: ['morning'] }),
  q('Morning. {temp} out, {high} coming. Coffee is still the first step.', S, {
    time: ['morning'],
  }),
  q('Early start, {temp} outside. The day is waiting patiently; the bus is not.', S, {
    time: ['morning'],
    weekend: false,
  }),
  q('A slow weekend morning at {temp}. Nowhere to be. Lovely.', F, {
    time: ['morning'],
    weekend: true,
  }),
  q('Midday check: {temp}, heading for {high}. Lunch is a good idea.', F, { time: ['midday'] }),
  q('Peak day. {temp} now. If a walk was planned, this is the walk window.', S, {
    time: ['midday'],
  }),
  q('Afternoon, {temp} and easing toward {low} tonight. Snack time is also a weather event.', F, {
    time: ['afternoon'],
  }),
  q('Afternoon slump weather, {temp}. Step outside for two minutes; it works.', S, {
    time: ['afternoon'],
  }),
  q('Evening, {temp} and cooling to {low}. Dinner, dishes, done.', F, { time: ['evening'] }),
  q('Evening settling in at {temp}. The day is nearly out of your hands. Let it go.', S, {
    time: ['evening'],
  }),
  q('Late and {temp}. The forecast recommends sleep. So does everyone else.', S, {
    time: ['night'],
  }),
  q('Night. {temp} out, {low} by dawn. Lights off soon, friend.', F, { time: ['night'] }),

  /* --- season, any sky --- */
  q('Winter is doing its thing. Soup counts as a plan.', F, { season: ['winter'] }),
  q('Deep winter. The days are short; make the coffee strong.', S, { season: ['winter'] }),
  q('Winter light at {temp}. Short days, long evenings, good lamps.', F, {
    season: ['winter'],
    time: ['afternoon', 'evening'],
  }),
  q('Spring has started negotiating. {temp} today, no promises for tomorrow.', S, {
    season: ['spring'],
  }),
  q('Spring air at {temp}. Something is blooming and something is sneezing.', F, {
    season: ['spring'],
  }),
  q('Spring. Wear layers; the day will change its mind at least twice.', S, { season: ['spring'] }),
  q('Summer, {temp} and bright. Sunscreen is the whole plan.', F, { season: ['summer'] }),
  q('Peak summer. The sun has been up for hours and would like you to know it.', S, {
    season: ['summer'],
    time: ['morning'],
  }),
  q('A summer evening at {temp}. Stay out until the first mosquito.', S, {
    season: ['summer'],
    time: ['evening'],
  }),
  q('Autumn and {temp}. Crunchy leaves, warm drinks, smug scarves.', F, { season: ['autumn'] }),
  q('Autumn is here. The leaves are quitting in style.', S, { season: ['autumn'] }),
  q('Fall morning at {temp}. Breath you can see, cocoa you can smell.', F, {
    season: ['autumn'],
    time: ['morning'],
    band: ['cold', 'cool'],
  }),
  q('Late autumn. Daylight is a limited-time offer; use it before four.', S, {
    season: ['autumn'],
    time: ['midday', 'afternoon'],
  }),

  /* --- weekend and weekday, any sky --- */
  q('Weekend weather report: {temp}, and nobody has to be anywhere. Correct.', F, {
    weekend: true,
  }),
  q('It is the weekend and it is {temp}. Whatever you do, do it slowly.', S, { weekend: true }),
  q('Monday-ish energy out there, {temp}. The week will improve. Probably.', S, {
    weekend: false,
    time: ['morning'],
  }),
  q('A work day at {temp}. Step outside at lunch; your brain will thank you.', F, {
    weekend: false,
    time: ['midday'],
  }),

  /* --- any time, any sky, any temperature --- */
  q('{temp} right now, {high} at the top, {low} tonight. That is the whole story.', 'any'),
  q('Dress for {temp}, plan for {high}, sleep at {low}. Simple.', 'any'),
  q('Weather: present. Temperature: {temp}. Vibes: your call.', S),
  q("It's {temp}. The display cares about you. Please wear appropriate shoes.", S),
  q('Whatever the sky does, {temp} is a fine number to start from.', F),
  q('Today in weather: {temp}, trending toward {high}. Be kind to someone.', F),
  q('The weather is out there doing weather things at {temp}. Go say hello.', F),
  q('Forecast summary: {low} to {high}. Everything else is commentary.', S),
  q('Highs of {high}, lows of {low}. Pick a coat and commit.', S),
  q('Another day, another {temp}. Make it a good one.', F),

  /* --- a few more combinations, so the common days do not repeat --- */
  q('Snow in winter, as advertised. The season is finally on brand.', S, {
    sky: ['snow'],
    season: ['winter'],
  }),
  q('Winter snow, {temp}. Cocoa stock levels should be checked immediately.', F, {
    sky: ['snow'],
    season: ['winter'],
  }),
  q('A clear summer evening at {temp}. Dinner outside, dishes later.', F, {
    sky: ['clear'],
    season: ['summer'],
    time: ['evening'],
  }),
  q('Sunny summer morning. The day has potential; so do you, after coffee.', S, {
    sky: ['clear'],
    season: ['summer'],
    time: ['morning'],
  }),
  q('Clear autumn day, {temp}. Leaf-kicking conditions: excellent.', F, {
    sky: ['clear'],
    season: ['autumn'],
  }),
  q('Crisp and clear, very autumn. Someone will say "sweater weather" today. It might be you.', S, {
    sky: ['clear'],
    season: ['autumn'],
    band: ['cool', 'cold'],
  }),
  q('Clear spring morning. Birds are loud, pollen is louder.', S, {
    sky: ['clear'],
    season: ['spring'],
    time: ['morning'],
  }),
  q('Spring sunshine at {temp}. Open a window and let the house breathe.', F, {
    sky: ['clear'],
    season: ['spring'],
  }),
  q('Clear winter sky, {temp}. Bright, cold and honest about it.', F, {
    sky: ['clear'],
    season: ['winter'],
  }),
  q('Winter sun. Lovely to look at, no help at all.', S, {
    sky: ['clear'],
    season: ['winter'],
    band: ['freezing', 'cold'],
  }),
  q('Autumn drizzle. Hood up, leaves slippery, kettle on when you get back.', F, {
    sky: ['drizzle'],
    season: ['autumn'],
  }),
  q('Grey winter afternoon. Lights on at three, no shame in it.', S, {
    sky: ['cloudy'],
    season: ['winter'],
    time: ['afternoon'],
  }),
  q('Cloudy summer day, {temp}. The clouds are a courtesy. Say thanks.', F, {
    sky: ['cloudy'],
    season: ['summer'],
  }),
  q('Overcast spring morning. The flowers do not mind; neither should you.', F, {
    sky: ['cloudy'],
    season: ['spring'],
    time: ['morning'],
  }),
  q('Partly cloudy autumn morning at {temp}. The good kind of chilly.', F, {
    sky: ['partly'],
    season: ['autumn'],
    time: ['morning'],
  }),
  q('Partly cloudy and hot. The clouds are not helping as much as they think.', S, {
    sky: ['partly'],
    band: ['hot'],
  }),
  q('Rain and wind together. Umbrellas are decorative today; wear the hood.', S, {
    sky: ['rain', 'drizzle'],
    band: ['cool', 'cold'],
    time: ['morning', 'midday'],
  }),
  q('Rainy midday at {temp}. Soup has never looked better.', F, {
    sky: ['rain'],
    time: ['midday'],
    band: ['cold', 'cool'],
  }),
  q('Storms on a weekend. Movie marathon conditions confirmed.', F, {
    sky: ['storm'],
    weekend: true,
  }),
  q('A stormy school night. Early bed, loud sky, no complaints heard.', S, {
    sky: ['storm'],
    weekend: false,
    time: ['evening'],
  }),
  q('Windy weekend. Kite, scarf, hair tie. Pick two.', S, { sky: ['wind'], weekend: true }),
  q('Fog on a school morning. Leave a little earlier and drive like a grown-up.', F, {
    sky: ['fog'],
    weekend: false,
    time: ['morning'],
  }),
  q('Hot summer midday. Shade, water, and a strong opinion about air conditioning.', S, {
    band: ['hot'],
    season: ['summer'],
    time: ['midday'],
  }),
  q('Freezing winter morning, {temp}. Scrape the car, warm the hands, repeat tomorrow.', S, {
    band: ['freezing'],
    season: ['winter'],
    time: ['morning'],
  }),
  q('Mild spring evening, {temp}. The first sit-outside of the year, maybe.', F, {
    band: ['mild'],
    season: ['spring'],
    time: ['evening'],
  }),
];
