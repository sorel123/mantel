/**
 * Natural add, rules first: a phrase from Siri, Alexa, Home Assistant or a script becomes one
 * action (list items, an event, a meal or a wall note) with no Claude key. The rules know the
 * household's list names and people, simple dates ("Tuesday", "tomorrow", "Dec 3", "the 12th")
 * and times ("at 3", "3:30pm", "noon"). `confident` is false when the rules fell back to "add it
 * to the default list", which is when Claude (if a key is saved) gets a look.
 */
import type { SayAction } from '@mantel/shared';
import { shiftDate } from '../import/zone.js';

export interface SayContext {
  /** Today in the household's zone, `YYYY-MM-DD`. */
  today: string;
  lists: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  /** Where plain items go; null picks Grocery, then Shopping, then the first list. */
  defaultListId: string | null;
  /** Who is speaking, for "my" and "me". */
  personId?: string;
  /** Meal names the household already uses (favourites, recent plans). */
  mealNames?: string[];
}

export interface Parsed {
  action: SayAction;
  /** False when the phrase fell through to the default list without any clue. */
  confident: boolean;
}

/* ---------- words ---------- */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE =
  '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(\\d{1,2})(?:st|nd|rd|th)?';
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const num = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);

/** Dishes and meal words: "tacos Thursday" plans a meal, "soccer Thursday" adds an event. */
const FOODS = new Set(
  `tacos taco pizza pasta spaghetti lasagna lasagne burgers burger hamburgers hot dogs hotdogs
  chili chilli soup stew curry stir fry stirfry fajitas burritos burrito enchiladas quesadillas
  nachos salad salmon fish chicken steak pork chops ribs meatloaf meatballs roast casserole
  sandwiches sandwich wraps pancakes waffles french toast omelette omelet eggs breakfast for dinner
  leftovers takeout take out sushi ramen noodles pad thai fried rice dumplings risotto gnocchi
  mac and cheese macaroni grilled cheese sloppy joes shepherds pie pot pie pie quiche frittata
  kebabs kabobs gyros falafel shawarma bbq barbecue brisket pulled pork tuna bagels oatmeal
  porridge cereal smoothies roast chicken chicken nuggets nuggets fish sticks fish and chips
  jambalaya gumbo paella tikka masala butter chicken dal daal pho bibimbap teriyaki schnitzel
  pierogi pierogies goulash hash potatoes baked potatoes jacket potatoes cottage pie bolognese
  carbonara alfredo ravioli tortellini calzones flatbread pita tostadas tamales poke bowls
  rice bowls grain bowls buddha bowls tofu veggie burgers lentils beans`
    .split(/\s+/)
    .filter(Boolean),
);
const FOOD_PHRASES = [
  'hot dogs',
  'stir fry',
  'french toast',
  'take out',
  'pad thai',
  'fried rice',
  'mac and cheese',
  'grilled cheese',
  'sloppy joes',
  'shepherds pie',
  'pot pie',
  'pulled pork',
  'roast chicken',
  'chicken nuggets',
  'fish sticks',
  'fish and chips',
  'tikka masala',
  'butter chicken',
  'baked potatoes',
  'breakfast for dinner',
];

/** Items that contain "and" but are one thing. */
const COMPOUNDS = [
  'mac and cheese',
  'macaroni and cheese',
  'salt and pepper',
  'peanut butter and jelly',
  'fish and chips',
  'half and half',
  'bread and butter',
  'sour cream and onion',
  'salt and vinegar',
  'pork and beans',
  'rice and beans',
  'cookies and cream',
  'chips and salsa',
  'spaghetti and meatballs',
  'black and white',
  'ham and cheese',
];

const SLOT_WORDS: Record<string, 'breakfast' | 'lunch' | 'dinner'> = {
  breakfast: 'breakfast',
  brunch: 'lunch',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  tea: 'dinner',
};

/* ---------- small helpers ---------- */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const pad = (n: number) => String(n).padStart(2, '0');

function weekdayIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((d) => d.startsWith(w));
}

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w));
}

/** The next `month`/`day` on or after today. */
function nextMonthDay(today: string, month: number, day: number): string | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const d = new Date(Date.UTC(y, month, day));
    if (d.getUTCMonth() !== month) return null;
    const iso = d.toISOString().slice(0, 10);
    if (iso >= today) return iso;
  }
  return null;
}

/* ---------- dates ---------- */

interface Found<T> {
  value: T;
  /** The phrase with the matched words taken out. */
  rest: string;
  /** "tonight" leans an ambiguous hour toward the evening. */
  evening?: boolean;
}

/** Find a date in the phrase. Bare weekdays mean the next one after today. */
export function findDate(text: string, today: string): Found<string> | null {
  const tries: Array<[RegExp, (m: RegExpExecArray) => string | null, boolean?]> = [
    [/\b(?:on\s+)?(?:the\s+)?day after tomorrow\b/i, () => shiftDate(today, 2)],
    [/\b(?:for\s+|on\s+)?tomorrow(?:\s+night)?\b/i, () => shiftDate(today, 1)],
    [/\b(?:for\s+)?tonight\b/i, () => today, true],
    [/\b(?:for\s+|on\s+)?today\b/i, () => today],
    [/\b(?:on\s+)?this\s+weekend\b/i, () => shiftDate(today, (6 - weekdayOf(today) + 7) % 7)],
    [
      /\bin\s+(a|an|one|two|three|four|five|six|seven|\d{1,2})\s+(day|days|week|weeks)\b/i,
      (m) => {
        const n = /^an?$/i.test(m[1]!) ? 1 : num(m[1]!);
        return shiftDate(today, /week/i.test(m[2]!) ? n * 7 : n);
      },
    ],
    [
      new RegExp(`\\b(?:on\\s+)?(this|next|on)?\\s*${WEEKDAY_RE}\\b(?:\\s+(night|evening))?`, 'i'),
      (m) => {
        const target = weekdayIndex(m[2]!);
        if (target < 0) return null;
        let ahead = (target - weekdayOf(today) + 7) % 7;
        if (ahead === 0) ahead = m[1]?.toLowerCase() === 'this' ? 0 : 7;
        return shiftDate(today, ahead);
      },
    ],
    [
      new RegExp(`\\b(?:on\\s+)?${MONTH_RE}\\.?\\s+${ORD}\\b`, 'i'),
      (m) => nextMonthDay(today, monthIndex(m[1]!), Number(m[2])),
    ],
    [
      new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?${ORD}\\s+of\\s+${MONTH_RE}\\b`, 'i'),
      (m) => nextMonthDay(today, monthIndex(m[2]!), Number(m[1])),
    ],
    [
      /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/,
      (m) => nextMonthDay(today, Number(m[1]) - 1, Number(m[2])),
    ],
    [
      /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i,
      (m) => {
        const day = Number(m[1]);
        const month = Number(today.slice(5, 7)) - 1;
        const year = Number(today.slice(0, 4));
        for (let i = 0; i < 3; i++) {
          const d = new Date(Date.UTC(year, month + i, day));
          const iso = d.toISOString().slice(0, 10);
          if (d.getUTCDate() === day && iso >= today) return iso;
        }
        return null;
      },
    ],
  ];
  for (const [re, toDate, evening] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const value = toDate(m);
    if (!value) continue;
    const isEvening = evening || /night|evening/i.test(m[0]);
    return {
      value,
      rest: squash(text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)),
      ...(isEvening ? { evening: true } : {}),
    };
  }
  return null;
}

/* ---------- times ---------- */

export interface TimeRange {
  start: string;
  end?: string;
}

function toClock(hour: number, minute: number, meridiem: string | undefined, evening: boolean) {
  let h = hour;
  const m = meridiem?.toLowerCase().replace(/\./g, '');
  if (m === 'pm' || m === 'p') h = h === 12 ? 12 : h + 12;
  else if (m === 'am' || m === 'a') h = h === 12 ? 0 : h;
  else if (h <= 12) {
    // No am or pm: family things happen in the day. 1 to 6 is the afternoon; 7 to 11 is the
    // morning unless the phrase says tonight or evening.
    if (evening && h < 12) h += 12;
    else if (h >= 1 && h <= 6) h += 12;
  }
  if (h > 23 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/** Find a time ("at 3", "3:30pm", "noon", "from 3 to 5", "for 2 hours"). */
export function findTime(text: string, evening = false): Found<TimeRange> | null {
  let rest = text;
  const dayPart = /\b(in the morning|in the afternoon|in the evening|at night)\b/i.exec(rest);
  let lean: 'am' | 'pm' | undefined;
  if (dayPart) {
    lean = /morning/i.test(dayPart[1]!) ? 'am' : 'pm';
    rest = squash(rest.replace(dayPart[0], ' '));
  }
  const word = /\b(?:at\s+)?(noon|midday|midnight)\b/i.exec(rest);
  const T = `${NUM}(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|am|pm|a|p)?(?:\\s*o'?clock)?`;
  const range = new RegExp(`\\b(?:from\\s+|at\\s+)?${T}\\s*(?:-|–|to|until|till)\\s*${T}\\b`, 'i');
  const single = new RegExp(
    `(?:\\b(?:at|@)\\s*${T}\\b|\\b(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|am|pm)(?=\\W|$)|\\b(\\d{1,2})[:.](\\d{2})\\b|\\b${NUM}\\s*o'?clock\\b)`,
    'i',
  );

  let found: TimeRange | null = null;
  let match: RegExpExecArray | null = null;
  const r = range.exec(rest);
  if (r && (/^at|^from/i.test(r[0]) || r[3] || r[6] || r[2] || r[5])) {
    const endMer = r[6] ?? lean;
    const start = toClock(num(r[1]!), Number(r[2] ?? 0), r[3] ?? endMer, evening);
    const end = toClock(num(r[4]!), Number(r[5] ?? 0), endMer, evening);
    if (start && end) {
      found = { start, end: end > start ? end : undefined };
      if (!found.end) delete found.end;
      match = r;
    }
  }
  if (!found && word) {
    found = { start: /midnight/i.test(word[1]!) ? '00:00' : '12:00' };
    match = word;
  }
  if (!found) {
    const s = single.exec(rest);
    if (s) {
      const [h, m, mer] = s[1]
        ? [s[1], s[2], s[3]]
        : s[4]
          ? [s[4], s[5], s[6]]
          : s[7]
            ? [s[7], s[8], undefined]
            : [s[9]!, undefined, undefined];
      const start = toClock(num(h!), Number(m ?? 0), mer ?? lean, evening);
      if (start) {
        found = { start };
        match = s;
      }
    }
  }
  if (!found || !match) return null;
  rest = squash(rest.slice(0, match.index) + ' ' + rest.slice(match.index + match[0].length));
  const dur =
    /\bfor\s+(an?|one|two|three|four|\d{1,3}(?:\.5)?)\s*(hours?|hrs?|minutes?|mins?)\b/i.exec(rest);
  if (dur && !found.end) {
    const n = /^an?$/i.test(dur[1]!) ? 1 : (NUMBER_WORDS[dur[1]!.toLowerCase()] ?? Number(dur[1]));
    const minutes = /^h/i.test(dur[2]!) ? n * 60 : n;
    const [h, m] = found.start.split(':').map(Number) as [number, number];
    const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
    found.end = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    rest = squash(rest.replace(dur[0], ' '));
  }
  return { value: found, rest };
}

/* ---------- people and lists ---------- */

/** People named in the phrase ("Ava's dentist", "for Leo", "Sam and Jay"), and the rest. */
export function findPeople(
  text: string,
  people: SayContext['people'],
  me?: string,
): { ids: string[]; rest: string } {
  let rest = text;
  const ids: string[] = [];
  for (const p of people) {
    const name = esc(p.name);
    const own = new RegExp(`\\b${name}['’]s\\b\\s*`, 'i');
    const forName = new RegExp(`\\b(?:for|with)\\s+${name}\\b`, 'i');
    const bare = new RegExp(`\\b${name}\\b`, 'i');
    if (own.test(rest)) {
      rest = rest.replace(own, '');
      ids.push(p.id);
    } else if (forName.test(rest)) {
      rest = rest.replace(forName, ' ');
      ids.push(p.id);
    } else if (bare.test(rest)) {
      ids.push(p.id);
      // A bare name at the start or end is who it is for; in the middle it stays in the title.
      const m = bare.exec(rest)!;
      const atEdge = m.index === 0 || m.index + m[0].length >= rest.replace(/[\s.!?]+$/, '').length;
      if (atEdge) rest = rest.replace(bare, ' ');
    }
  }
  if (me && /\b(?:my|me)\b/i.test(rest) && !ids.includes(me)) {
    ids.push(me);
    rest = rest.replace(/\bmy\b/i, ' ').replace(/\bfor me\b/i, ' ');
  }
  rest = squash(rest.replace(/\s+(?:and|&)\s*$/i, '').replace(/^\s*(?:and|&)\s+/i, ''));
  return { ids, rest };
}

const listKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(the|my|our|a)\b/g, ' ')
    .replace(/\blist\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(ies)$/, 'y')
    .replace(/s$/, '');

/** A list by spoken name: "groceries" finds Grocery, "shopping" finds Grocery when there is none. */
export function findList(spoken: string, lists: SayContext['lists']) {
  const key = listKey(spoken);
  if (!key) return null;
  const exact = lists.find((l) => listKey(l.name) === key);
  if (exact) return exact;
  const partial = lists.find((l) => {
    const k = listKey(l.name);
    return k && (k.includes(key) || key.includes(k));
  });
  if (partial) return partial;
  if (/^(grocer|shop|food|supermarket|store)/.test(key))
    return lists.find((l) => /grocer|shopping/i.test(l.name)) ?? null;
  if (/^(to ?do|todo|task|chore)/.test(key))
    return lists.find((l) => /to ?do|task/i.test(l.name)) ?? null;
  return null;
}

export function defaultList(ctx: SayContext) {
  return (
    (ctx.defaultListId ? ctx.lists.find((l) => l.id === ctx.defaultListId) : undefined) ??
    ctx.lists.find((l) => /grocer/i.test(l.name)) ??
    ctx.lists.find((l) => /shopping/i.test(l.name)) ??
    ctx.lists[0] ??
    null
  );
}

/** "milk, eggs and bread" → three items; "mac and cheese" stays one. */
export function splitItems(text: string): string[] {
  let t = ` ${text} `;
  const saved: string[] = [];
  for (const c of COMPOUNDS) {
    t = t.replace(new RegExp(`\\b${esc(c)}\\b`, 'gi'), (m) => {
      saved.push(m);
      return `\uE000${saved.length - 1}\uE000`;
    });
  }
  return t
    .split(/\s*(?:,|;|\band also\b|\band\b|&|\bplus\b|\balso\b)\s*/i)
    .map((s) => s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => saved[Number(i)]!))
    .map((s) =>
      squash(s)
        .replace(/^(?:some|more|a few|a couple of|a|an|the)\s+/i, '')
        .replace(/[.!?]+$/, ''),
    )
    .filter((s) => s.length > 0)
    .map((s) => cap(s.slice(0, 200)))
    .slice(0, 30);
}

/* ---------- meals ---------- */

function isFood(text: string, mealNames: string[]): boolean {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, ' ');
  const words = squash(t);
  if (!words) return false;
  if (mealNames.some((n) => n.toLowerCase() === words)) return true;
  if (FOOD_PHRASES.some((p) => words.includes(p))) return true;
  const list = words
    .split(' ')
    .filter(
      (w) =>
        !/^(we're|were|having|have|make|making|eat|eating|homemade|some|the|a|with|and|on|for)$/.test(
          w,
        ),
    );
  return list.length > 0 && list.length <= 4 && list.some((w) => FOODS.has(w));
}

function cleanMealTitle(text: string): string {
  return cap(
    squash(
      squash(text)
        .replace(
          /^(?:we(?:'re| are)\s+having|we(?:'re| are)\s+eating|having|make|making|eat|let's have|lets have|cook|cooking)\s+/i,
          '',
        )
        .replace(/\b(?:is|will be|=)\s*$/i, '')
        .replace(/^(?:is|will be)\s+/i, '')
        .replace(/^(?:on|for)\s+|\s+(?:on|for)$/gi, ''),
    ),
  );
}

/* ---------- the parser ---------- */

const FILLER =
  /^(?:(?:hey|ok|okay)\s+)?(?:mantel[,:]?\s+)?(?:please\s+|can you\s+|could you\s+|would you\s+)?/i;

function stripPolite(text: string): string {
  return squash(
    squash(text)
      .replace(FILLER, '')
      .replace(/(?:^|\s+)please[.!]*$/i, '')
      .replace(/[.!?]+$/, ''),
  );
}

function titleFrom(text: string): string {
  return cap(
    squash(
      text
        .replace(
          /^(?:add|put|schedule|create|make|set up|new)\s+(?:an?\s+)?(?:event\s+)?(?:for\s+)?/i,
          '',
        )
        .replace(/^(?:remind me to|remind us to|don't forget|dont forget)\s+/i, '')
        .replace(/\s+(?:to|on|in)\s+(?:the\s+)?calendar$/i, '')
        .replace(/^(?:is|has|have|at|on|for)\s+|\s+(?:at|on|for|is|has)$/gi, '')
        .replace(/^['’]s\s+/, ''),
    ),
  ).slice(0, 200);
}

export function parseSay(input: string, ctx: SayContext): Parsed {
  const text = stripPolite(input);
  if (!text) return { action: { kind: 'none', reason: 'Nothing was said.' }, confident: true };

  // 1. A wall note: "note: back at 5", "leave a note for Ava saying ...".
  const note =
    /^(?:leave|post|put up|write|add)?\s*(?:a\s+)?(?:wall\s+)?note(?:\s+(?:for|to)\s+([a-z]+))?\s*(?:saying|that says|that|:|,|-)?\s*(.+)$/i.exec(
      text,
    );
  if (note && /^(?:leave|post|put up|write|add|a|wall|note)/i.test(text)) {
    const who = note[1]
      ? ctx.people.find((p) => p.name.toLowerCase() === note[1]!.toLowerCase())
      : null;
    const body = cap(squash(note[2]!)).slice(0, 280);
    if (body)
      return {
        action: { kind: 'note', text: body, ...(who ? { personId: who.id } : {}) },
        confident: true,
      };
  }

  // 2. Items for a named list: "add milk to groceries", "put tape on the hardware list",
  //    "grocery list: milk and eggs", "we're out of milk".
  const named =
    /^(?:add|put|get|buy|pick up|we need|i need|need|we're out of|we are out of|out of)?\s*(.+?)\s+(?:to|on|onto|in|into)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+list)?$/i.exec(
      text,
    );
  if (named) {
    const list = findList(named[2]!, ctx.lists);
    const saysList = /\blist$/i.test(text);
    // "add dentist on Tuesday" is not a list called Tuesday.
    const looksLikeDate = findDate(`on ${named[2]!}`, ctx.today);
    if ((list || saysList) && !looksLikeDate) {
      const items = splitItems(named[1]!);
      if (items.length) {
        const name = list?.name ?? cap(squash(named[2]!.replace(/\blist$/i, ''))).slice(0, 60);
        return {
          action: { kind: 'items', listId: list?.id ?? null, listName: name, items },
          confident: true,
        };
      }
    }
  }
  const prefixed = /^(?:(?:the|my|our)\s+)?(.+?)\s+list\s*[:,-]?\s+(.+)$/i.exec(text);
  if (prefixed && !/^(?:add|put)\b/i.test(text)) {
    const list = findList(prefixed[1]!, ctx.lists);
    const items = splitItems(prefixed[2]!);
    if (items.length)
      return {
        action: {
          kind: 'items',
          listId: list?.id ?? null,
          listName: list?.name ?? cap(prefixed[1]!).slice(0, 60),
          items,
        },
        confident: true,
      };
  }

  // 3. Dates and times.
  const date = findDate(text, ctx.today);
  const time = findTime(date?.rest ?? text, !!date?.evening);
  const rest = time?.rest ?? date?.rest ?? text;

  // 4. A meal: "tacos for dinner Thursday", "Thursday dinner is tacos", "tacos Thursday".
  const slotMatch = /\b(?:for\s+)?(breakfast|brunch|lunch|dinner|supper)\b/i.exec(rest);
  const mealNames = ctx.mealNames ?? [];
  if (date && !time) {
    if (slotMatch) {
      const title = cleanMealTitle(rest.replace(slotMatch[0], ' '));
      if (title && !/^(?:out|at|with)\b/i.test(title))
        return {
          action: {
            kind: 'meal',
            date: date.value,
            slot: SLOT_WORDS[slotMatch[1]!.toLowerCase()]!,
            title: title.slice(0, 80),
          },
          confident: true,
        };
    } else if (isFood(rest, mealNames)) {
      const title = cleanMealTitle(rest);
      if (title)
        return {
          action: { kind: 'meal', date: date.value, slot: 'dinner', title: title.slice(0, 80) },
          confident: true,
        };
    }
  }
  if (
    !date &&
    !time &&
    slotMatch &&
    /^(?:for\s+)?(?:dinner|supper|lunch|breakfast)\b|\bfor (?:dinner|supper|lunch|breakfast)$/i.test(
      rest,
    )
  ) {
    const title = cleanMealTitle(rest.replace(slotMatch[0], ' '));
    if (title && isFood(title, mealNames))
      return {
        action: {
          kind: 'meal',
          date: ctx.today,
          slot: SLOT_WORDS[slotMatch[1]!.toLowerCase()]!,
          title: title.slice(0, 80),
        },
        confident: true,
      };
  }

  // 5. An event: anything with a date or a time.
  if (date || time) {
    const who = findPeople(rest, ctx.people, ctx.personId);
    const title = titleFrom(who.rest);
    if (title) {
      return {
        action: {
          kind: 'event',
          title,
          date: date?.value ?? ctx.today,
          ...(time ? { start: time.value.start } : {}),
          ...(time?.value.end ? { end: time.value.end } : {}),
          allDay: !time,
          personIds: who.ids,
        },
        confident: true,
      };
    }
  }

  // 6. Plain things for the default list: "milk and eggs", "add paper towels".
  const plain = text.replace(
    /^(?:add|put|get|buy|pick up|we need|i need|need|we're out of|we are out of|out of|remember)\s+/i,
    '',
  );
  const items = splitItems(plain);
  const list = defaultList(ctx);
  if (!items.length)
    return { action: { kind: 'none', reason: 'Nothing to add was found.' }, confident: false };
  const hinted = /^(?:add|get|buy|pick up|we need|we're out of|we are out of|out of)\b/i.test(text);
  return {
    action: {
      kind: 'items',
      listId: list?.id ?? null,
      listName: list?.name ?? 'Grocery',
      items,
    },
    // A short shopping-shaped phrase is as good as certain; a long sentence is worth a second look.
    confident: hinted || items.every((i) => i.split(' ').length <= 3),
  };
}

/* ---------- what to say back ---------- */

export const joinAnd = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  if (h === 12 && m === 0) return 'noon';
  if (h === 0 && m === 0) return 'midnight';
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "today", "tomorrow", "on Thursday", "on Thursday, December 3". */
export function spokenDate(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === shiftDate(today, 1)) return 'tomorrow';
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = cap(WEEKDAYS[d.getUTCDay()]!);
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5,
  );
  if (days > 1 && days < 7) return `on ${weekday}`;
  return `on ${weekday}, ${cap(MONTHS[d.getUTCMonth()]!)} ${d.getUTCDate()}`;
}

/** The sentence to speak back, for an action that was (or, on a dry run, would be) done. */
export function describe(action: SayAction, today: string, dryRun = false): string {
  const lead = (done: string, would: string) => (dryRun ? would : done);
  switch (action.kind) {
    case 'items': {
      const what =
        action.items.length > 4
          ? `${action.items.length} things`
          : joinAnd(action.items.map((i) => i.toLowerCase()));
      return `${lead('Added', 'Would add')} ${what} to ${action.listName}.`;
    }
    case 'event': {
      const when = spokenDate(action.date, today);
      const at = action.start ? ` at ${spokenTime(action.start)}` : '';
      return `${lead('Added', 'Would add')} ${action.title} ${when}${at}.`;
    }
    case 'meal': {
      const when = spokenDate(action.date, today);
      return `${lead('Planned', 'Would plan')} ${action.title} for ${action.slot} ${when}.`;
    }
    case 'note':
      return dryRun ? `Would post a note: ${action.text}` : 'Posted your note on the wall.';
    case 'none':
      return `Sorry, I didn't catch anything to add. ${action.reason}`.trim();
  }
}
