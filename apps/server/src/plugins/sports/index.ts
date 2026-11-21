/**
 * Sports (v4 G): follow teams through ESPN's public site API (no key; it is the JSON espn.com
 * itself loads, undocumented but stable for years and widely used by home dashboards), plus any
 * team schedule as an .ics link. Next game, live score while it is on, and the final with a
 * banner. Checks every 15 minutes, every minute while a game is live.
 */
import {
  addDays,
  type IntegrationConfig,
  type PluginBlocksInput,
  type PluginChipInput,
  type TestResult,
} from '@mantel/shared';
import type { ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import {
  AlertOnce,
  bool,
  clock,
  dayDiff,
  dayWord,
  enabled,
  entries,
  fetchIcsEvents,
  inDays,
  plural,
  str,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

/** League → ESPN sport path. Soccer leagues are written like `eng.1`, `usa.1`, `uefa.champions`. */
const SPORT: Record<string, string> = {
  nfl: 'football',
  'college-football': 'football',
  nba: 'basketball',
  wnba: 'basketball',
  'mens-college-basketball': 'basketball',
  'womens-college-basketball': 'basketball',
  mlb: 'baseball',
  'college-baseball': 'baseball',
  nhl: 'hockey',
};
export const sportOf = (league: string) =>
  SPORT[league] ?? (/^[a-z]{3,5}\.[a-z0-9_]+$|^mls$|^nwsl$/.test(league) ? 'soccer' : null);

export interface Game {
  team: string;
  /** "Lions vs Packers" or "Lions 24, Packers 17". */
  text: string;
  state: 'pre' | 'in' | 'post';
  start: string;
  /** "4th 2:11", "Final (OT)". */
  detail: string;
  /** For the chip: "DET 24–17 GB". */
  short: string;
  result?: 'Won' | 'Lost' | 'Tied';
  id: string;
}

export interface TeamRef {
  league: string;
  team: string;
}

export function parseTeams(text: unknown): TeamRef[] {
  return entries(text).flatMap((e) => {
    const [league, team] = e
      .toLowerCase()
      .split('/')
      .map((s) => s.trim());
    return league && team && sportOf(league) ? [{ league, team }] : [];
  });
}

/* ---------- ESPN's JSON, read defensively ---------- */

type Json = Record<string, unknown>;
const o = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const score = (c: Json) => s(o(c.score).displayValue) || s(c.score);

/** One ESPN event (from a team's schedule or `nextEvent`) as a Game, seen from `teamId`. */
export function gameFrom(event: unknown, teamAbbr: string): Game | null {
  const ev = o(event);
  const comp = o(a(ev.competitions)[0]);
  const competitors = a(comp.competitors).map(o);
  if (competitors.length < 2) return null;
  const status = o(o(comp.status ?? ev.status).type);
  const state = (s(status.state) || 'pre') as Game['state'];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0]!;
  const away = competitors.find((c) => c !== home) ?? competitors[1]!;
  const name = (c: Json) =>
    s(o(c.team).shortDisplayName) || s(o(c.team).displayName) || s(o(c.team).abbreviation);
  const abbr = (c: Json) => s(o(c.team).abbreviation);
  const ours = competitors.find((c) => abbr(c).toLowerCase() === teamAbbr.toLowerCase()) ?? home;
  const theirs = ours === home ? away : home;
  const start = s(comp.date) || s(ev.date);
  const text =
    state === 'pre'
      ? `${name(ours)} ${ours === home ? 'vs' : 'at'} ${name(theirs)}`
      : `${name(ours)} ${score(ours)}, ${name(theirs)} ${score(theirs)}`;
  const a1 = Number(score(ours));
  const b1 = Number(score(theirs));
  const result =
    state === 'post' && Number.isFinite(a1) && Number.isFinite(b1)
      ? a1 > b1 || ours.winner === true
        ? 'Won'
        : a1 < b1
          ? 'Lost'
          : 'Tied'
      : undefined;
  return {
    team: name(ours),
    text,
    state,
    start,
    detail: s(status.shortDetail) || s(status.detail) || s(status.description),
    short: `${abbr(ours)} ${score(ours)}–${score(theirs)} ${abbr(theirs)}`,
    ...(result ? { result } : {}),
    id: s(ev.id) || `${start}|${text}`,
  };
}

/** The game to show for a team: live first, then today's final, then the next one, then the last. */
export function pickGame(games: Game[], now: Date): Game | null {
  const live = games.find((g) => g.state === 'in');
  if (live) return live;
  const sorted = [...games].sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  const recentFinal = sorted
    .filter((g) => g.state === 'post' && now.getTime() - Date.parse(g.start) < 18 * 3600_000)
    .at(-1);
  if (recentFinal) return recentFinal;
  return (
    sorted.find((g) => g.state === 'pre' && Date.parse(g.start) > now.getTime() - 4 * 3600_000) ??
    sorted.filter((g) => g.state === 'post').at(-1) ??
    null
  );
}

async function espnGames(fetcher: typeof fetch, ref: TeamRef): Promise<Game[]> {
  const base = `${ESPN}/${sportOf(ref.league)}/${ref.league}/teams/${encodeURIComponent(ref.team)}`;
  const get = async (url: string) => {
    const res = await fetcher(url, { headers: { accept: 'application/json' } });
    if (res.status === 404 || res.status === 400)
      throw new Error(
        `ESPN does not know ${ref.league}/${ref.team}. Check the short name in the team’s espn.com address.`,
      );
    if (!res.ok) throw new Error(`ESPN answered ${res.status}.`);
    return o(await res.json());
  };
  const [team, schedule] = await Promise.all([
    get(base),
    get(`${base}/schedule`).catch(() => ({}) as Json),
  ]);
  const abbr = s(o(team.team).abbreviation) || ref.team;
  const events = [...a(o(team.team).nextEvent), ...a(o(schedule).events)];
  const seen = new Set<string>();
  return events
    .map((e) => gameFrom(e, abbr))
    .filter((g): g is Game => g !== null && !seen.has(g.id) && Boolean(seen.add(g.id)));
}

/** Mock mode: a live game, one later this week and last night's win. */
export function mockGames(now: Date): Game[] {
  const iso = (d: Date) => d.toISOString();
  const tonight = new Date(addDays(now, 2));
  tonight.setHours(20, 0, 0, 0);
  return [
    {
      team: 'Lions',
      text: 'Lions 24, Packers 17',
      state: 'in',
      start: iso(new Date(now.getTime() - 2.5 * 3600_000)),
      detail: '4th 2:11',
      short: 'DET 24–17 GB',
      id: 'm1',
    },
    {
      team: 'Pistons',
      text: 'Pistons at Bulls',
      state: 'pre',
      start: iso(tonight),
      detail: '',
      short: 'DET at CHI',
      id: 'm2',
    },
    {
      team: 'Red Wings',
      text: 'Red Wings 3, Bruins 2',
      state: 'post',
      start: iso(new Date(now.getTime() - 15 * 3600_000)),
      detail: 'Final (OT)',
      short: 'DET 3–2 BOS',
      result: 'Won',
      id: 'm3',
    },
  ];
}

export function sportsCard(games: Game[], now: Date, configured: boolean): PluginBlocksInput {
  const live = games.filter((g) => g.state === 'in');
  return {
    title: live.length === 1 ? `${live[0]!.team} are playing` : 'Sports',
    icon: 'trophy',
    lines: games.map((g) => {
      const d = new Date(g.start);
      const when = `${dayWord(d, now)} ${clock(d)}`;
      const extra = inDays(d, now);
      return {
        id: g.id,
        icon:
          g.state === 'in'
            ? 'trophy'
            : g.state === 'post'
              ? g.result === 'Won'
                ? 'check'
                : 'trophy'
              : 'calendar',
        text: g.text,
        sub:
          g.state === 'in'
            ? `Live · ${g.detail}`
            : g.state === 'post'
              ? `${g.detail || 'Final'}${g.result ? ` · ${g.result}` : ''}`
              : `${when}${extra ? ` · ${extra}` : ''}`,
        tone:
          g.state === 'in' ? ('warn' as const) : g.result === 'Won' ? ('good' as const) : 'normal',
      };
    }),
    empty: configured ? 'No games coming up.' : 'Pick your teams in Settings, Plugins, Sports.',
  };
}

export function sportsPlugin(deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let games: Game[] = [];
  let lastOkAt: string | null = null;
  let lastError: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const alerts = new AlertOnce(() => ctx, 'sports');
  const now = () => ctx?.now() ?? new Date();
  const fetcher = deps.fetch ?? fetch;
  const configured = () => parseTeams(config.teams).length > 0 || Boolean(str(config.icsUrl));
  const mock = () => deps.mock && !configured();

  const shown = (): Game[] => (mock() ? mockGames(now()) : games);

  const refresh = async () => {
    if (mock() || !configured()) {
      games = [];
      return;
    }
    const t = now();
    const out: Game[] = [];
    const errors: string[] = [];
    for (const ref of parseTeams(config.teams)) {
      try {
        const g = pickGame(await espnGames(fetcher, ref), t);
        if (g) out.push(g);
      } catch (err) {
        errors.push(humanError(err));
      }
    }
    const ics = str(config.icsUrl);
    if (ics)
      try {
        const evs = await fetchIcsEvents(
          fetcher,
          ics,
          new Date(t.getTime() - 3 * 3600_000),
          addDays(t, 21),
        );
        const next = evs.sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0];
        if (next)
          out.push({
            team: str(config.icsName) || 'Team',
            text: `${str(config.icsName) ? `${str(config.icsName)}: ` : ''}${next.title}`,
            state: 'pre',
            start: next.start,
            detail: next.location ?? '',
            short: str(config.icsName) || next.title,
            id: `ics|${next.uid}`,
          });
      } catch (err) {
        errors.push(humanError(err));
      }
    const before = JSON.stringify(games);
    games = out.sort((x, y) =>
      x.state === 'in' ? -1 : y.state === 'in' ? 1 : Date.parse(x.start) - Date.parse(y.start),
    );
    lastError = errors[0] ?? null;
    if (out.length || !errors.length) lastOkAt = t.toISOString();
    if (JSON.stringify(games) !== before)
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'sports' } });
    if (ctx && bool(config.finals, true) && enabled(ctx, 'sports'))
      for (const g of games.filter(
        (x) => x.state === 'post' && t.getTime() - Date.parse(x.start) < 8 * 3600_000,
      ))
        alerts.send({
          key: `final|${g.id}`,
          title: g.result === 'Won' ? `${g.team} won!` : `Final: ${g.text}`,
          text: g.text,
          icon: 'trophy',
        });
  };

  const loop = async () => {
    clearTimeout(timer);
    await refresh().catch(() => {});
    if (stopped) return;
    const live = games.some((g) => g.state === 'in');
    const soon = games.some(
      (g) => g.state === 'pre' && Math.abs(Date.parse(g.start) - now().getTime()) < 20 * 60_000,
    );
    timer = setTimeout(() => void loop(), live || soon ? 60_000 : 15 * 60_000);
  };

  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    apply(next) {
      config = next;
      void loop();
    },
    async test(next): Promise<TestResult> {
      const refs = parseTeams(next.teams);
      if (!refs.length && !str(next.icsUrl))
        return { ok: false, message: 'Add a team as league/team (nfl/det), or a schedule link.' };
      if (deps.mock)
        return {
          ok: true,
          message: `Following ${plural(refs.length, 'team')} (mock mode, nothing was contacted).`,
        };
      try {
        const found: string[] = [];
        for (const ref of refs) {
          const g = pickGame(await espnGames(fetcher, ref), now());
          found.push(
            g
              ? `${g.text} (${g.state === 'pre' ? dayWord(new Date(g.start), now()) : g.state === 'in' ? 'live' : 'final'})`
              : `${ref.team.toUpperCase()}: no games`,
          );
        }
        if (str(next.icsUrl)) {
          const evs = await fetchIcsEvents(fetcher, str(next.icsUrl), now(), addDays(now(), 60));
          found.push(`${plural(evs.length, 'game')} on the schedule link`);
        }
        return { ok: true, message: `Found: ${found.join('; ')}.` };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      if (mock())
        return {
          state: 'connected',
          summary: 'Following 3 teams (sample)',
          lastOkAt,
          lastError: null,
        };
      if (!configured())
        return { state: 'not_set_up', summary: 'No teams yet', lastOkAt: null, lastError: null };
      const n = parseTeams(config.teams).length + (str(config.icsUrl) ? 1 : 0);
      return {
        state: lastError && !games.length ? 'error' : 'connected',
        summary: `Following ${plural(n, 'team')}`,
        lastOkAt,
        lastError,
      };
    },
    blocks(name) {
      const list = shown();
      if (name === 'card') return sportsCard(list, now(), configured() || Boolean(deps.mock));
      if (name === 'ambient') {
        const live = list.find((g) => g.state === 'in');
        if (live) return { title: `${live.text} · ${live.detail}`, icon: 'trophy', lines: [] };
        const today = list.find(
          (g) => g.state === 'pre' && dayDiff(now(), new Date(g.start)) === 0,
        );
        if (today)
          return {
            title: `${today.text} at ${clock(new Date(today.start))}`,
            icon: 'trophy',
            lines: [],
          };
        return null;
      }
      return undefined;
    },
    chip(name): PluginChipInput | null | undefined {
      if (name !== 'chip') return undefined;
      const live = shown().find((g) => g.state === 'in');
      return live
        ? { text: live.short, icon: 'trophy', tone: 'warn', label: `${live.text}, ${live.detail}` }
        : null;
    },
  };
}
