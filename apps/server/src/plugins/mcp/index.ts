/**
 * Mantel as an MCP server (v4 O): `POST /mcp`, the streamable HTTP transport answering plain
 * JSON (no server-sent stream is needed: every tool answers at once). A Claude app, Claude Code
 * or any MCP client adds it with the URL and an API token; the tools it lists are the ones the
 * token's scopes allow. Stateless: no session id, so any number of clients can share it.
 */
import { MCP_PATH, type SayAction, type TokenScope } from '@mantel/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { scopeAllows, tokenFromHeaders, type TokenIdentity } from '../../auth.js';
import { log } from '../../log.js';
import { VERSION } from '../../version.js';
import { checkActionScope, type OpenService } from '../voice/index.js';
import { shiftDate, wallIso } from '../import/zone.js';
import { dateInZone } from '../../providers/real/weather-time.js';
import { joinAnd, spokenTime } from '../voice/parse.js';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM, 24-hour');

interface Tool {
  name: string;
  title: string;
  description: string;
  scopes: TokenScope[];
  input: z.ZodObject;
  readOnly: boolean;
  run: (args: Record<string, unknown>, who: TokenIdentity) => Promise<string>;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

const rpcError = (id: Rpc['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

export function mcpTools(deps: AppDeps, open: OpenService): Tool[] {
  const { providers, settings } = deps;
  const tz = () => settings.get().timezone;
  const today = () => dateInZone(new Date(), tz());
  const people = () => settings.get().people;
  const personIds = (names: string[] | undefined) =>
    (names ?? []).flatMap((n) => {
      const p = people().find((x) => x.id === n || x.name.toLowerCase() === n.trim().toLowerCase());
      return p ? [p.id] : [];
    });
  const nameOf = (id: string) => people().find((p) => p.id === id)?.name ?? id;
  const runAction = async (action: SayAction, who: TokenIdentity, done: string) => {
    checkActionScope(who, action);
    const problem = await open.run(action);
    if (problem) throw new Error(problem);
    return done;
  };

  return [
    {
      name: 'get_agenda',
      title: 'Read the family calendar',
      description:
        'Events on the family calendar for one or more days, with times and who each is for.',
      scopes: ['read', 'calendar'],
      readOnly: true,
      input: z.object({
        start: IsoDate.optional().describe('First day, YYYY-MM-DD. Default today.'),
        days: z.number().int().min(1).max(31).optional().describe('How many days. Default 1.'),
      }),
      run: async (a) => {
        const start = (a.start as string | undefined) ?? today();
        const days = (a.days as number | undefined) ?? 1;
        const { events } = await providers.calendar.events(
          new Date(wallIso(start, '00:00', tz())),
          new Date(wallIso(shiftDate(start, days), '00:00', tz())),
        );
        if (!events.length) return `Nothing on the calendar from ${start} for ${days} day(s).`;
        return events
          .map((e) => {
            const who = e.personIds.map(nameOf);
            const when = e.allDay
              ? `${e.start.slice(0, 10)} all day`
              : `${e.start.slice(0, 10)} ${spokenTime(e.start.slice(11, 16))}–${spokenTime(e.end.slice(11, 16))}`;
            return `- ${when}: ${e.title}${who.length ? ` (${joinAnd(who)})` : ''}${e.location ? ` @ ${e.location}` : ''} [id ${e.id}]`;
          })
          .join('\n');
      },
    },
    {
      name: 'get_today',
      title: 'Summary of the day',
      description:
        'A short spoken-style summary: weather, events, dinner, grocery list and chores.',
      scopes: ['read'],
      readOnly: true,
      input: z.object({ day: z.enum(['today', 'tomorrow']).optional() }),
      run: async (a) =>
        (await open.todayText((a.day as 'today' | 'tomorrow' | undefined) ?? 'today')).text,
    },
    {
      name: 'get_lists',
      title: 'Read the lists',
      description: 'Every family list (grocery, to-do...) with the items still to get or do.',
      scopes: ['read', 'lists'],
      readOnly: true,
      input: z.object({
        list: z.string().optional().describe('Only this list, by name.'),
        includeDone: z.boolean().optional(),
      }),
      run: async (a) => {
        const { lists } = await providers.lists.lists();
        const want = (a.list as string | undefined)?.toLowerCase();
        const chosen = want ? lists.filter((l) => l.name.toLowerCase().includes(want)) : lists;
        if (!chosen.length) return want ? `No list called ${a.list}.` : 'There are no lists yet.';
        return chosen
          .map((l) => {
            const items = l.items.filter((i) => a.includeDone || !i.done);
            return `${l.name}:\n${items.map((i) => `- ${i.done ? '[x] ' : ''}${i.text}`).join('\n') || '- (empty)'}`;
          })
          .join('\n\n');
      },
    },
    {
      name: 'get_meals',
      title: 'Read the meal plan',
      description: "The week's planned meals (breakfast, lunch, dinner).",
      scopes: ['read', 'meals'],
      readOnly: true,
      input: z.object({
        week: IsoDate.optional().describe('Any day in the week. Default this week.'),
      }),
      run: async (a) => {
        const week = a.week ? new Date(wallIso(a.week as string, '12:00', tz())) : undefined;
        const { meals } = await providers.calendar.meals(week).catch(() => ({ meals: [] }));
        return meals.length
          ? meals.map((m) => `- ${m.date} ${m.slot}: ${m.title}`).join('\n')
          : 'No meals planned that week.';
      },
    },
    {
      name: 'get_chores',
      title: 'Read the chore chart',
      description: "Each person's chores, how many are done, and this week's stars.",
      scopes: ['read', 'chores'],
      readOnly: true,
      input: z.object({}),
      run: async () => {
        const { chores, stars } = await providers.lists.chores();
        return people()
          .map((p) => {
            const mine = chores.filter((c) => c.personId === p.id);
            const s = stars.find((t) => t.personId === p.id)?.stars ?? 0;
            return `${p.name} (${s} stars this week):\n${mine.map((c) => `- ${c.doneCount >= c.target ? '[done] ' : ''}${c.title} [id ${c.id}]`).join('\n') || '- no chores'}`;
          })
          .join('\n\n');
      },
    },
    {
      name: 'add_event',
      title: 'Add a calendar event',
      description: 'Add an event to the family calendar. Leave start empty for an all-day event.',
      scopes: ['calendar', 'capture'],
      readOnly: false,
      input: z.object({
        title: z.string().min(1).max(200),
        date: IsoDate,
        start: Clock.optional(),
        end: Clock.optional(),
        people: z.array(z.string()).optional().describe('Family member names or ids.'),
        location: z.string().max(300).optional(),
      }),
      run: (a, who) =>
        runAction(
          {
            kind: 'event',
            title: a.title as string,
            date: a.date as string,
            ...(a.start ? { start: a.start as string } : {}),
            ...(a.start && a.end ? { end: a.end as string } : {}),
            allDay: !a.start,
            personIds: personIds(a.people as string[] | undefined),
            ...(a.location ? { location: a.location as string } : {}),
          },
          who,
          `Added ${a.title as string} on ${a.date as string}${a.start ? ` at ${a.start as string}` : ''}.`,
        ),
    },
    {
      name: 'add_items',
      title: 'Add to a list',
      description:
        'Add items to a family list. Without a list name they go on the grocery list (or the default list chosen in Settings).',
      scopes: ['lists', 'capture'],
      readOnly: false,
      input: z.object({
        items: z.array(z.string().min(1).max(200)).min(1).max(30),
        list: z.string().max(60).optional(),
      }),
      run: async (a, who) => {
        const ctx = await open.context();
        const name = a.list as string | undefined;
        const list = name
          ? ctx.lists.find((l) => l.name.toLowerCase() === name.toLowerCase())
          : (ctx.lists.find((l) => l.id === ctx.defaultListId) ??
            ctx.lists.find((l) => /grocer|shopping/i.test(l.name)) ??
            ctx.lists[0]);
        const listName = list?.name ?? name ?? 'Grocery';
        const items = a.items as string[];
        return runAction(
          { kind: 'items', listId: list?.id ?? null, listName, items },
          who,
          `Added ${joinAnd(items)} to ${listName}.`,
        );
      },
    },
    {
      name: 'plan_meal',
      title: 'Plan a meal',
      description: 'Put a meal on the plan for a day. Slot defaults to dinner.',
      scopes: ['meals', 'capture'],
      readOnly: false,
      input: z.object({
        date: IsoDate,
        title: z.string().min(1).max(80),
        slot: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
      }),
      run: (a, who) => {
        const slot = (a.slot as 'breakfast' | 'lunch' | 'dinner' | undefined) ?? 'dinner';
        return runAction(
          { kind: 'meal', date: a.date as string, slot, title: a.title as string },
          who,
          `Planned ${a.title as string} for ${slot} on ${a.date as string}.`,
        );
      },
    },
    {
      name: 'post_note',
      title: 'Post a wall note',
      description: 'Put a short sticky note on the wall display (it comes down after a day).',
      scopes: ['capture'],
      readOnly: false,
      input: z.object({
        text: z.string().min(1).max(280),
        person: z.string().optional().describe('Who it is for, by name.'),
      }),
      run: (a, who) => {
        const [personId] = personIds(a.person ? [a.person as string] : []);
        return runAction(
          { kind: 'note', text: a.text as string, ...(personId ? { personId } : {}) },
          who,
          'Posted the note on the wall.',
        );
      },
    },
    {
      name: 'complete_chore',
      title: 'Mark a chore done',
      description:
        'Tick off a chore on the chart by its id or title (and person, if titles repeat).',
      scopes: ['chores'],
      readOnly: false,
      input: z.object({ chore: z.string().min(1), person: z.string().optional() }),
      run: async (a) => {
        const { chores } = await providers.lists.chores();
        const want = (a.chore as string).toLowerCase();
        const [pid] = personIds(a.person ? [a.person as string] : []);
        const c =
          chores.find((x) => x.id === a.chore) ??
          chores.find((x) => x.title.toLowerCase() === want && (!pid || x.personId === pid));
        if (!c) throw new Error(`No chore called ${a.chore as string}.`);
        await providers.lists.choreDone(c.id, pid);
        return `Marked ${c.title} done for ${nameOf(c.personId)}.`;
      },
    },
    {
      name: 'say',
      title: 'Add anything, in plain words',
      description:
        'Mantel\'s natural add: "milk and eggs", "dentist Tuesday at 3", "tacos Thursday", "note: back at 5". Returns what it did.',
      scopes: ['capture', 'lists', 'calendar', 'meals'],
      readOnly: false,
      input: z.object({ text: z.string().min(1).max(2000) }),
      run: async (a, who) => {
        const r = await open.say({ text: a.text as string, source: 'mcp' }, (action) =>
          checkActionScope(who, action),
        );
        if (!r.ok) throw new Error(r.speech);
        return r.speech;
      },
    },
  ];
}

/** The identity of an MCP request: a token, a device key (everything), or mock mode. */
function whoIs(c: Context, deps: AppDeps): TokenIdentity | null {
  const secret = tokenFromHeaders((h) => c.req.header(h)) ?? c.req.query('token') ?? null;
  if (secret) return deps.tokens.verify(secret);
  const device = deps.auth.verify(c.req.header('x-mantel-device-key'));
  if (device) return { id: device, name: 'this display', scopes: ['admin'] };
  return null;
}

export function mountMcp(app: Hono, deps: AppDeps, open: OpenService) {
  const tools = mcpTools(deps, open);
  const allowed = (who: TokenIdentity) => tools.filter((t) => scopeAllows(who.scopes, t.scopes));

  const handleOne = async (msg: Rpc, who: TokenIdentity) => {
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const asked = (msg.params as { protocolVersion?: string } | undefined)?.protocolVersion;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion:
              asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'mantel', title: 'Mantel family wall', version: VERSION },
            instructions:
              "Mantel is a family's wall calendar. Read the agenda, lists, meals and chores, and add events, list items, meals and wall notes. Dates are in the family's time zone (" +
              deps.settings.get().timezone +
              ').',
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: allowed(who).map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: z.toJSONSchema(t.input),
              annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
            })),
          },
        };
      case 'tools/call': {
        const p = (msg.params ?? {}) as { name?: string; arguments?: unknown };
        const tool = tools.find((t) => t.name === p.name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${p.name}`);
        if (!scopeAllows(who.scopes, tool.scopes))
          return rpcError(id, -32602, `The token "${who.name}" cannot use ${tool.name}.`);
        const args = tool.input.safeParse(p.arguments ?? {});
        if (!args.success)
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Invalid arguments: ${args.error.message}` }],
              isError: true,
            },
          };
        try {
          const text = await tool.run(args.data as Record<string, unknown>, who);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], isError: false },
          };
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          log.warn(`mcp: ${tool.name} failed`, { err: text });
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], isError: true },
          };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  };

  app.post(MCP_PATH, async (c) => {
    const who =
      whoIs(c, deps) ??
      (deps.config.MOCK ? { id: 'mock', name: 'mock', scopes: ['admin' as const] } : null);
    if (!who)
      return c.json(
        rpcError(null, -32001, 'Send an API token: Authorization: Bearer mtl_...'),
        401,
        {
          'www-authenticate': 'Bearer realm="mantel"',
        },
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const batch = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc];
    const answers = [];
    for (const msg of batch) {
      // Notifications and responses from the client need no answer.
      if (msg?.id === undefined || msg.id === null || !msg.method) continue;
      answers.push(await handleOne(msg, who));
    }
    if (!answers.length) return c.body(null, 202);
    return c.json(Array.isArray(body) ? answers : answers[0]);
  });
  // No server-initiated stream: GET and DELETE are not offered.
  app.on(['GET', 'DELETE'], MCP_PATH, (c) =>
    c.json(rpcError(null, -32000, 'Use POST. This server answers every call directly.'), 405, {
      allow: 'POST',
    }),
  );
}
