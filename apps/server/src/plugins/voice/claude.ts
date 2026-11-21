/**
 * Natural add with Claude: when the rules are unsure (a long sentence, no list word, no date),
 * and a Claude key is saved, Claude reads the phrase into the same action shape. Any failure
 * falls back to the rules' answer, so voice adds never break because Claude is slow or down.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SayAction } from '@mantel/shared';
import { IMPORT_MODEL } from '../import/claude.js';
import type { SayContext } from './parse.js';

export const SAY_MODEL = IMPORT_MODEL;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'list', 'items', 'title', 'date', 'start', 'end', 'people', 'slot', 'text'],
  properties: {
    kind: { type: 'string', enum: ['items', 'event', 'meal', 'note', 'none'] },
    list: { type: 'string', description: 'For items: an existing list name, or a short new one' },
    items: { type: 'array', items: { type: 'string' }, description: 'For items: each thing' },
    title: { type: 'string', description: 'Event title or meal name' },
    date: { type: 'string', description: 'YYYY-MM-DD for an event or meal, else empty' },
    start: { type: 'string', description: 'HH:MM 24-hour, empty when all day' },
    end: { type: 'string', description: 'HH:MM 24-hour, or empty' },
    people: { type: 'array', items: { type: 'string' }, description: 'Ids of family members' },
    slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', ''] },
    text: { type: 'string', description: 'For a note: its words. For none: why' },
  },
} as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function sayPrompt(ctx: SayContext): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()];
  return [
    'You turn one short spoken phrase into one action for a family wall calendar. The phrase came from Siri, Alexa or a phone.',
    `Today is ${weekday} ${ctx.today}. A bare weekday means the next one after today.`,
    'kinds: "items" adds things to a list (shopping, to-dos); "event" adds to the calendar (anything with a date or time that is not a meal); "meal" plans a meal on a day; "note" posts a short note on the wall; "none" when nothing sensible can be added.',
    `Lists: ${ctx.lists.map((l) => l.name).join(', ') || 'none yet'}. Without a list named, items go on ${ctx.lists.find((l) => l.id === ctx.defaultListId)?.name ?? 'the grocery list'}.`,
    `Family (id: name): ${ctx.people.map((p) => `${p.id}: ${p.name}`).join('; ') || 'none'}.`,
    'Keep titles and items short and in plain words, capitalised like a person would write them. Never invent a time; an event with no time is all day. Times without am or pm between 1 and 6 are in the afternoon.',
    'Fill every field; use empty strings and empty arrays for the ones that do not apply.',
  ].join('\n');
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Claude's answer made safe and checked against the action schema; null when it does not fit. */
export function toAction(raw: Raw, ctx: SayContext): SayAction | null {
  const ids = new Set(ctx.people.map((p) => p.id));
  const kind = str(raw.kind);
  let candidate: unknown;
  if (kind === 'items') {
    const name = str(raw.list);
    const list =
      ctx.lists.find((l) => l.name.toLowerCase() === name.toLowerCase()) ??
      (name ? null : (ctx.lists.find((l) => l.id === ctx.defaultListId) ?? ctx.lists[0] ?? null));
    candidate = {
      kind,
      listId: list?.id ?? null,
      listName: list?.name ?? (name || 'Grocery'),
      items: (Array.isArray(raw.items) ? raw.items : []).map(str).filter(Boolean),
    };
  } else if (kind === 'event') {
    const start = str(raw.start);
    candidate = {
      kind,
      title: str(raw.title),
      date: str(raw.date),
      ...(start ? { start } : {}),
      ...(start && str(raw.end) ? { end: str(raw.end) } : {}),
      allDay: !start,
      personIds: (Array.isArray(raw.people) ? raw.people : []).map(str).filter((p) => ids.has(p)),
    };
  } else if (kind === 'meal') {
    candidate = {
      kind,
      date: str(raw.date),
      slot: str(raw.slot) || 'dinner',
      title: str(raw.title),
    };
  } else if (kind === 'note') {
    candidate = { kind, text: str(raw.text) };
  } else {
    candidate = { kind: 'none', reason: str(raw.text) || 'Nothing to add was found.' };
  }
  const parsed = SayAction.safeParse(candidate);
  if (!parsed.success) return null;
  const a = parsed.data;
  if (a.kind === 'event' && a.start && !/^\d{2}:\d{2}$/.test(a.start)) return null;
  return a;
}

export interface ClaudeSayInput {
  apiKey: string;
  text: string;
  ctx: SayContext;
  client?: Pick<Anthropic, 'messages'>;
  fetch?: typeof fetch;
}

/** Null when Claude could not help in time; the caller keeps the rules' answer. */
export async function sayWithClaude(input: ClaudeSayInput): Promise<SayAction | null> {
  const client =
    input.client ??
    new Anthropic({ apiKey: input.apiKey, maxRetries: 0, timeout: 8_000, fetch: input.fetch });
  try {
    const response = await client.messages.create({
      model: SAY_MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: sayPrompt(input.ctx),
      messages: [{ role: 'user', content: input.text }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return toAction(JSON.parse(text) as Raw, input.ctx);
  } catch {
    return null;
  }
}
