/**
 * Magic Import's reader: one photo (a school flyer, a team schedule, a handwritten list, a menu)
 * goes to Claude with vision, and comes back as structured candidates that the person checks
 * before anything is written. Uses the Claude key saved for weather quips.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ImportAnalyseResponse,
  ImportEvent,
  ImportItem,
  ImportMeal,
  type ImportHint,
  type List,
  type Person,
} from '@mantel/shared';

export const IMPORT_MODEL = 'claude-sonnet-5-5';

export interface AnalyseInput {
  apiKey: string;
  /** `data:image/jpeg;base64,...` */
  image: string;
  hint: ImportHint;
  /** Today in the household's zone, `YYYY-MM-DD`, and the weekday name. */
  today: string;
  weekday: string;
  timeZone: string;
  people: Person[];
  lists: List[];
  client?: Pick<Anthropic, 'beta'>;
  fetch?: typeof fetch;
}

/** The JSON shape Claude must answer in (structured outputs). */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'events', 'items', 'meals'],
  properties: {
    summary: {
      type: 'string',
      description:
        'One short sentence for the family: what the photo is and what was found, or why nothing was.',
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'date',
          'allDay',
          'start',
          'end',
          'endDate',
          'location',
          'people',
          'notes',
        ],
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: {
            type: 'string',
            description: 'YYYY-MM-DD last day of a multi-day all-day event, else empty',
          },
          allDay: { type: 'boolean' },
          start: { type: 'string', description: 'HH:MM 24-hour, or empty when all day' },
          end: { type: 'string', description: 'HH:MM 24-hour, or empty when unknown' },
          location: { type: 'string', description: 'Place or address, or empty' },
          people: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Ids of family members the event is for, from the list given; may be empty',
          },
          notes: { type: 'string', description: 'A useful detail (bring, wear, cost), or empty' },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['list', 'text'],
        properties: {
          list: {
            type: 'string',
            description: 'Name of an existing list from the ones given, or a short new name',
          },
          text: { type: 'string' },
        },
      },
    },
    meals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'slot', 'title'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'other'] },
          title: { type: 'string' },
        },
      },
    },
  },
} as const;

const HINTS: Record<ImportHint, string> = {
  auto: 'Decide from the photo whether it holds events, list items, meals or a mix.',
  events: 'The person expects dates and times for the calendar; look hardest for events.',
  list: 'The person expects things to add to a list (shopping, supplies, to-dos).',
  meals: 'The person expects a meal plan or menu for the coming days.',
};

export function systemPrompt(input: Omit<AnalyseInput, 'apiKey' | 'image'>): string {
  return [
    'You read photos for a family wall calendar: school flyers, team schedules, party invitations, handwritten lists, menus, appointment cards.',
    'Turn what is in the photo into calendar events, list items and meals. Everything you return is shown to the family to check before it is saved.',
    `Today is ${input.weekday} ${input.today} (time zone ${input.timeZone}). Resolve dates without a year to the next time they occur on or after today; "Friday" means the next Friday.`,
    'Only use what the photo says. Never invent a date, time or place. Skip a date you cannot read rather than guess.',
    'An event with no time is all day. Keep titles short (under 60 characters) and in plain words, the way a parent would write them on a calendar.',
    'Repeating schedules (every Tuesday practice) become one event per listed date, at most 20.',
    `Family members (id: name): ${input.people.map((p) => `${p.id}: ${p.name}`).join('; ') || 'none set up'}. Put a member's id in people only when the photo names them or is clearly theirs.`,
    `Existing lists: ${input.lists.map((l) => l.name).join(', ') || 'none'}. Put supplies and groceries on the grocery list unless another list fits better.`,
    HINTS[input.hint],
    'If the photo holds nothing usable, return empty arrays and say why in the summary.',
  ].join('\n');
}

type Raw = {
  summary?: string;
  events?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  meals?: Array<Record<string, unknown>>;
};

const blank = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Claude's JSON made safe: each candidate checked on its own, the bad ones dropped. */
export function cleanCandidates(raw: Raw, people: Person[], lists: List[]): ImportAnalyseResponse {
  const ids = new Set(people.map((p) => p.id));
  const events = (raw.events ?? []).flatMap((e) => {
    const allDay = e.allDay === true || !blank(e.start);
    const parsed = ImportEvent.safeParse({
      title: blank(e.title)?.slice(0, 200),
      date: blank(e.date),
      ...(blank(e.endDate) ? { endDate: blank(e.endDate) } : {}),
      allDay,
      ...(!allDay && blank(e.start) ? { start: blank(e.start) } : {}),
      ...(!allDay && blank(e.end) ? { end: blank(e.end) } : {}),
      ...(blank(e.location) ? { location: blank(e.location)!.slice(0, 300) } : {}),
      personIds: Array.isArray(e.people)
        ? (e.people as unknown[]).filter((p): p is string => typeof p === 'string' && ids.has(p))
        : [],
      ...(blank(e.notes) ? { notes: blank(e.notes)!.slice(0, 500) } : {}),
    });
    return parsed.success ? [parsed.data] : [];
  });
  const items = (raw.items ?? []).flatMap((i) => {
    const name = blank(i.list) ?? 'Grocery';
    const match = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    const parsed = ImportItem.safeParse({
      ...(match ? { listId: match.id } : {}),
      listName: (match?.name ?? name).slice(0, 60),
      text: blank(i.text)?.slice(0, 200),
    });
    return parsed.success ? [parsed.data] : [];
  });
  const meals = (raw.meals ?? []).flatMap((m) => {
    const parsed = ImportMeal.safeParse({
      date: blank(m.date),
      slot: m.slot,
      title: blank(m.title)?.slice(0, 200),
    });
    return parsed.success ? [parsed.data] : [];
  });
  const found = events.length + items.length + meals.length;
  return {
    summary:
      blank(raw.summary) ??
      (found
        ? `Found ${found} thing${found === 1 ? '' : 's'} to add.`
        : 'Nothing to add was found.'),
    events,
    items,
    meals,
  };
}

/** Why the photo could not be read, as a sentence for the person. */
export class ImportError extends Error {}

export async function analyseWithClaude(input: AnalyseInput): Promise<ImportAnalyseResponse> {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(input.image);
  if (!match) throw new ImportError('Send a JPEG or PNG photo.');
  const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const client =
    input.client ??
    new Anthropic({ apiKey: input.apiKey, maxRetries: 1, timeout: 90_000, fetch: input.fetch });
  let response;
  try {
    response = await client.beta.messages.create({
      model: IMPORT_MODEL,
      max_tokens: 16000,
      // Refused requests are retried on a fallback model chosen by the API.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: systemPrompt(input),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: match[2]! } },
            {
              type: 'text',
              text: 'What should go on the family calendar and lists from this photo?',
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      throw new ImportError('Claude refused the key. Copy it again in Settings › Weather quips.');
    if (err instanceof Anthropic.RateLimitError)
      throw new ImportError('Claude is busy right now. Try again in a minute.');
    if (err instanceof Anthropic.BadRequestError)
      throw new ImportError('Claude could not read that photo. Try a clearer, closer shot.');
    if (err instanceof Anthropic.APIError)
      throw new ImportError(
        `Claude answered with an error (${err.status ?? 'no status'}). Try again.`,
      );
    throw new ImportError('Could not reach Claude. Check the internet connection and try again.');
  }
  if (response.stop_reason === 'refusal')
    return { summary: 'Claude would not read this photo.', events: [], items: [], meals: [] };
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let raw: Raw;
  try {
    raw = JSON.parse(text) as Raw;
  } catch {
    throw new ImportError('Claude answered in a way Mantel could not read. Try again.');
  }
  return ImportAnalyseResponse.parse(cleanCandidates(raw, input.people, input.lists));
}
