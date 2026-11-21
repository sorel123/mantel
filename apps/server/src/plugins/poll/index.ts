/**
 * Family poll (v4 G): "Pizza or tacos?" Typed on the card's text box (the `input` block), each
 * person taps a choice, it closes at a set time (or Close now) and shows the winner, with a
 * banner. One poll at a time, kept in kv so a restart keeps the votes.
 */
import {
  type ConfigValue,
  type IntegrationConfig,
  type PluginActionInput,
  type PluginActionResponse,
  type PluginBlocksInput,
  type PluginChipInput,
  type TestResult,
} from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import {
  AlertOnce,
  bool,
  cap,
  clock,
  enabled,
  joinAnd,
  num,
  plural,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface Poll {
  id: string;
  question: string;
  options: string[];
  /** Voter (a person's name, or `anon-<n>`) → option index. */
  votes: Record<string, number>;
  createdAt: string;
  closesAt: string;
  closedAt?: string;
}

const KV = 'plugin.poll';
export const SUGGESTIONS = [
  'Pizza or tacos?',
  'Movie or board games?',
  'Park or pool?',
  'Pancakes or waffles?',
];

/**
 * "Pizza or tacos?" → Pizza, Tacos. "Dinner: pizza, tacos or curry" → three. "Movie night?" → Yes, No.
 */
export function parsePoll(text: string): { question: string; options: string[] } | null {
  const q = text.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return null;
  const colon = q.indexOf(':');
  const body = (colon > 0 ? q.slice(colon + 1) : q).replace(/[?!.]+$/, '');
  const options = body
    .split(/\s*,\s*|\s+or\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(cap);
  const unique = [...new Set(options)].slice(0, 6);
  const question = /[?]$/.test(q) ? q : `${q}?`;
  return unique.length >= 2
    ? { question: cap(question), options: unique }
    : { question: cap(question), options: ['Yes', 'No'] };
}

/** Indexes of the options with the most votes. */
export function leaders(poll: Poll): number[] {
  const counts = poll.options.map(
    (_, i) => Object.values(poll.votes).filter((v) => v === i).length,
  );
  const top = Math.max(...counts);
  return top ? counts.flatMap((c, i) => (c === top ? [i] : [])) : [];
}

export function winnerText(poll: Poll): string {
  const lead = leaders(poll);
  if (!lead.length) return 'No votes';
  if (lead.length > 1) return `A tie: ${joinAnd(lead.map((i) => poll.options[i]!))}`;
  return `${poll.options[lead[0]!]} wins`;
}

export function pollPlugin(_deps: PackDeps = {}): Plugin & { poll(): Poll | null } {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const alerts = new AlertOnce(() => ctx, 'poll');
  const now = () => ctx?.now() ?? new Date();
  const load = (): Poll | null => (ctx ? (kvGet<Poll | null>(ctx.db, KV) ?? null) : current);
  let current: Poll | null = null;
  const save = (p: Poll | null) => {
    current = p;
    if (ctx) kvSet(ctx.db, KV, p);
  };
  const changed = () => ctx?.emit({ type: 'plugin.changed', payload: { id: 'poll' } });
  const people = () => ctx?.settings().people.map((p) => p.name) ?? [];

  const close = (p: Poll, quiet = false) => {
    if (p.closedAt) return;
    p.closedAt = now().toISOString();
    save(p);
    changed();
    if (!quiet && ctx && bool(config.announce, true) && enabled(ctx, 'poll'))
      alerts.send({
        key: `closed|${p.id}`,
        title: winnerText(p),
        text: p.question,
        icon: 'trophy',
        chime: true,
      });
  };

  /** Close when the time comes; also on start, for a poll that ran out while the server was down. */
  const schedule = () => {
    clearTimeout(timer);
    const p = load();
    if (!p || p.closedAt) return;
    const wait = Date.parse(p.closesAt) - now().getTime();
    if (wait <= 0) close(p);
    else timer = setTimeout(schedule, Math.min(wait + 50, 2 ** 31 - 1));
  };

  const ask: PluginBlocksInput['input'] = {
    action: 'ask',
    label: 'Ask the family',
    placeholder: 'Pizza or tacos?',
    submit: 'Ask',
    suggestions: SUGGESTIONS,
  };

  const card = (): PluginBlocksInput => {
    const p = load();
    if (!p)
      return {
        title: 'Family poll',
        icon: 'vote',
        lines: [],
        empty: 'Ask the family something. Put “or” between the choices.',
        input: ask,
      };
    const counts = p.options.map((_, i) => Object.entries(p.votes).filter(([, v]) => v === i));
    const lead = leaders(p);
    const named = (voters: string[]) => voters.filter((v) => !v.startsWith('anon-'));
    const optionLines = p.options.map((o, i) => {
      const voters = counts[i]!.map(([who]) => who);
      const names = named(voters);
      return {
        id: `o${i}`,
        icon: lead.includes(i) && voters.length ? 'trophy' : 'vote',
        text: o,
        sub: `${plural(voters.length, 'vote')}${names.length ? ` · ${names.join(', ')}` : ''}`,
        tone: lead.includes(i) && voters.length ? ('good' as const) : ('normal' as const),
        actions:
          p.closedAt || people().length
            ? []
            : [{ name: 'vote', label: 'Vote', args: { option: i } } satisfies PluginActionInput],
      };
    });
    if (p.closedAt)
      return {
        title: winnerText(p),
        icon: 'trophy',
        lines: optionLines,
        footer: p.question,
        input: ask,
      };
    const waiting = people().filter((name) => p.votes[name] === undefined);
    const personLines = people().map((name) => ({
      id: `p-${name}`,
      text: name,
      sub: p.votes[name] === undefined ? 'Tap a choice' : `Picked ${p.options[p.votes[name]!]}`,
      tone: p.votes[name] === undefined ? ('normal' as const) : ('good' as const),
      actions: p.options.map((o, i) => ({
        name: 'vote',
        label: o,
        args: { option: i, by: name },
        tone: p.votes[name] === i ? ('primary' as const) : ('normal' as const),
      })),
    }));
    return {
      title: p.question,
      icon: 'vote',
      // With people to vote, their rows carry the choices and the tally goes in the footer.
      lines: personLines.length ? personLines : optionLines,
      footer: [
        personLines.length ? p.options.map((o, i) => `${o} ${counts[i]!.length}`).join(' · ') : '',
        `Closes at ${clock(new Date(p.closesAt))}`,
        waiting.length && waiting.length < people().length ? `waiting on ${joinAnd(waiting)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      actions: [
        { name: 'close', label: 'Close now' },
        { name: 'cancel', label: 'Cancel poll' },
      ],
    };
  };

  return {
    manifest,
    poll: load,
    start(c) {
      ctx = c;
      schedule();
    },
    stop() {
      clearTimeout(timer);
    },
    apply(next) {
      config = next;
    },
    async test(): Promise<TestResult> {
      return {
        ok: true,
        message: 'Built in. Ask from the Family poll card or the Poll chip in the dock.',
      };
    },
    status(): PluginStatusFields {
      const p = load();
      return {
        state: 'connected',
        summary: !p
          ? 'Ready: ask from the card or the dock'
          : p.closedAt
            ? `Last: ${winnerText(p)}`
            : `Open: ${p.question}`,
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      if (name === 'card') return card();
      if (name === 'ambient') {
        const p = load();
        if (!p) return null;
        if (!p.closedAt) return { title: `Vote: ${p.question}`, icon: 'vote', lines: [] };
        // The result stays on Ambient for the evening.
        return now().getTime() - Date.parse(p.closedAt) < 6 * 3600_000
          ? { title: `Poll: ${winnerText(p)}`, icon: 'trophy', lines: [] }
          : null;
      }
      return undefined;
    },
    chip(name): PluginChipInput | null | undefined {
      if (name !== 'chip') return undefined;
      const p = load();
      if (!p || p.closedAt) return null;
      return { text: 'Vote', icon: 'vote', tone: 'warn', label: `Poll open: ${p.question}` };
    },
    async action(name, args: Record<string, ConfigValue>): Promise<PluginActionResponse> {
      const p = load();
      switch (name) {
        case 'ask': {
          const parsed = parsePoll(typeof args.text === 'string' ? args.text : '');
          if (!parsed) throw new HttpError('bad_request', 'Type a question, like Pizza or tacos?');
          if (p && !p.closedAt) close(p, true);
          const at = now();
          const minutes = Math.max(5, num(args.minutes, num(config.closeAfter, 120)));
          save({
            id: `p${at.getTime().toString(36)}${(seq++).toString(36)}`,
            ...parsed,
            votes: {},
            createdAt: at.toISOString(),
            closesAt: new Date(at.getTime() + minutes * 60_000).toISOString(),
          });
          schedule();
          changed();
          return { ok: true, message: `Asked: ${parsed.question}` };
        }
        case 'vote': {
          if (!p || p.closedAt) throw new HttpError('bad_request', 'That poll has closed.');
          const option = num(args.option, -1);
          if (!p.options[option])
            throw new HttpError('bad_request', 'That choice is not on the poll.');
          const by =
            typeof args.by === 'string' && args.by
              ? args.by
              : `anon-${Object.keys(p.votes).length}`;
          p.votes[by] = option;
          save(p);
          changed();
          // Close early once everyone named has voted.
          const all = people();
          if (all.length && all.every((n) => p.votes[n] !== undefined)) close(p);
          return {
            ok: true,
            message: `${by.startsWith('anon-') ? 'Vote' : by} → ${p.options[option]}`,
          };
        }
        case 'close':
          if (!p || p.closedAt) throw new HttpError('bad_request', 'No poll is open.');
          close(p);
          return { ok: true, message: winnerText(p) };
        case 'cancel':
          save(null);
          clearTimeout(timer);
          changed();
          return { ok: true, message: 'Poll cancelled.' };
        default:
          throw new HttpError('not_found', `The poll can’t ${name}.`);
      }
    },
  };
}
