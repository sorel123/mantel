/**
 * The agenda card: all-day bands, countdown chips, a timeline with the now line and leave-by
 * chips, then (in the full variant) the rows chosen in Settings › Layout: tonight's meal, the
 * next three days, countdowns, the pinned list, a photo. The timeline takes only the room its
 * events need; the last stretchy row (photo, the next days, the list) takes the rest.
 */
import type { CalendarEvent, Meal, TodayRow } from '@mantel/shared';
import { DEFAULT_TODAY_ROWS, addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { PhotoSlideshow } from '../../features/photos';
import { GroceryPeek } from '../lists/GroceryPeek';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { LeaveByChip, matchLeaveBy, useCommute } from '../../features/weather';
import { useBootstrap } from '../../lib/bootstrap';
import {
  countdownLabel,
  dayNames,
  eventsOn,
  formatTime,
  monthNames,
  spanLabel,
  useCountdowns,
  useMeals,
} from './calendar';
import { Avatars, EventRow, Icon, Svg, pc } from './parts';

export function Countdowns() {
  const countdowns = useCountdowns().slice(0, 3);
  if (!countdowns.length) return null;
  return (
    <div className="countdowns" aria-label="Countdowns">
      {countdowns.map((c) => (
        <span key={c.eventId} className="countdown" style={pc(c.color)}>
          <Svg>{Icon.star}</Svg>
          <b>{c.title}</b>
          <span>{countdownLabel(c.daysRemaining)}</span>
        </span>
      ))}
    </div>
  );
}

export const slotWord: Record<Meal['slot'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  other: 'Snack',
};

/** Meals by date for today and the next three days (which can cross into next week). */
export function useMealPlan(today: Date): Map<string, Meal[]> {
  const thisWeek = useMeals(today);
  const later = useMeals(addDays(today, 3));
  return useMemo(() => {
    const out = new Map<string, Meal[]>();
    const seen = new Set<string>();
    for (const m of [...thisWeek.meals, ...later.meals]) {
      const k = `${m.date}|${m.slot}|${m.title}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.set(m.date, [...(out.get(m.date) ?? []), m]);
    }
    return out;
  }, [thisWeek, later]);
}

export const mainMeal = (ms: Meal[] | undefined) =>
  ms?.find((m) => m.slot === 'dinner') ?? ms?.at(-1);

export function Tonight({ meals }: { meals: Meal[] | undefined }) {
  const main = mainMeal(meals);
  const others = (meals ?? []).filter((m) => m !== main);
  return (
    <div className="tonight" aria-label="Tonight's meal">
      <Svg>{Icon.meal}</Svg>
      <span className="eyebrow">
        {!main || main.slot === 'dinner' ? 'Tonight' : slotWord[main.slot]}
      </span>
      <b className={main ? '' : 'none'}>{main?.title ?? 'Nothing planned'}</b>
      {others.length > 0 && (
        <span className="also">
          {others.map((m) => `${slotWord[m.slot]}: ${m.title}`).join(' · ')}
        </span>
      )}
    </div>
  );
}

/** Tonight's meal on its own, for presets that place it outside the agenda card. */
export function TonightSlot({ today }: { today: Date }) {
  const boot = useBootstrap();
  const meals = useMealPlan(today);
  if (!boot.flags.meals) return null;
  return <Tonight meals={meals.get(toIsoDate(today))} />;
}

export function Agenda({
  now,
  events,
  onAdd,
  onDay,
  onList,
  variant = 'full',
  rows: chosen = DEFAULT_TODAY_ROWS,
  toggle,
}: {
  now: Date;
  events: CalendarEvent[];
  onAdd: () => void;
  onDay: (day: Date) => void;
  /** Tapping the list row (opens the Lists screen). */
  onList?: () => void;
  /** `short` is the timeline and tonight alone, for presets that give the agenda less room. */
  variant?: 'full' | 'short';
  /** The rows under the timeline in the full variant, top to bottom. */
  rows?: TodayRow[];
  /** The Day/Week switch, shown in the header. */
  toggle?: ReactNode;
}) {
  const boot = useBootstrap();
  const today = startOfDay(now);
  const meals = useMealPlan(today);
  const todays = eventsOn(events, today);
  const allDay = todays.filter((e) => e.allDay);
  const timed = todays.filter((e) => !e.allDay);
  const t = now.getTime();
  const nowIndex = timed.findIndex((e) => new Date(e.start).getTime() > t);
  const trips = useCommute().data;
  const leaveBy = boot.flags.commute && trips ? matchLeaveBy(timed, trips) : null;
  const tl = useRef<HTMLDivElement>(null);
  const nowLine = useRef<HTMLDivElement>(null);

  // Keep the now line in view, with an event or two of context above it.
  useLayoutEffect(() => {
    const box = tl.current;
    const line = nowLine.current;
    if (box && line) box.scrollTop = Math.max(0, line.offsetTop - box.offsetTop - 150);
  }, [nowIndex, timed.length]);

  const line = (
    <div className="nowline" ref={nowLine} key="now">
      Now · {formatTime(now)}
    </div>
  );
  const rows = timed.map((e) => {
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    const state = en <= t ? 'past' : s <= t ? 'now' : undefined;
    const trip = leaveBy?.get(e.id);
    return (
      <EventRow
        key={e.id}
        event={e}
        day={today}
        state={state}
        extra={
          trip && state !== 'past' ? (
            <LeaveByChip trip={trip} now={now} color={e.color} />
          ) : undefined
        }
      />
    );
  });
  rows.splice(nowIndex === -1 ? rows.length : nowIndex, 0, line);

  const full = variant === 'full';
  const extra: TodayRow[] = full ? chosen : ['tonight'];
  // The one row that stretches into the room the timeline doesn't need.
  const grow = (['photo', 'week', 'list'] as const).find((r) => extra.includes(r));
  const row = (r: TodayRow): ReactNode => {
    const g = r === grow ? ' grow' : '';
    switch (r) {
      case 'tonight':
        return boot.flags.meals ? <Tonight key={r} meals={meals.get(toIsoDate(today))} /> : null;
      case 'countdowns':
        return boot.flags.countdowns ? <Countdowns key={r} /> : null;
      case 'week':
        return (
          <Upcoming
            key={r}
            className={g}
            today={today}
            events={events}
            meals={meals}
            onDay={onDay}
            perDay={grow === 'week' ? 5 : 2}
          />
        );
      case 'list':
        return (
          <div key={r} className={`arow list${g}`}>
            <GroceryPeek onOpen={onList} />
          </div>
        );
      case 'photo':
        return (
          <div key={r} className={`arow photo${g}`} aria-label="Photos">
            <PhotoSlideshow intervalMs={20_000} />
          </div>
        );
    }
  };

  return (
    <div className={`card agenda${full ? '' : ' short'}${grow ? ' has-grow' : ''}`}>
      <div className="head">
        <div className="l">
          <h2 className="h2">Today</h2>
          <span className="cnt">
            {todays.length === 0
              ? 'Nothing planned'
              : `${todays.length} ${todays.length === 1 ? 'event' : 'events'}`}
          </span>
        </div>
        <div className="r">
          {toggle}
          <Avatars ids={boot.people.map((p) => p.id)} />
          <button className="add" aria-label="Add an event today" onClick={onAdd}>
            <Svg>{Icon.plus}</Svg>
          </button>
        </div>
      </div>
      {allDay.length > 0 && (
        <div className="allday">
          {allDay.map((e) => (
            <span key={e.id} className="band" style={pc(e.color)}>
              <i />
              {e.title}
              {spanLabel(e, today) && <small>{spanLabel(e, today)}</small>}
            </span>
          ))}
        </div>
      )}
      {boot.flags.countdowns && !(full && extra.includes('countdowns')) && <Countdowns />}
      <div className="tl" ref={tl}>
        {boot.calendars.length === 0 ? (
          <EmptyState icon={EmptyIcon.calendar} action="Connect a calendar" section="calendars">
            No calendars connected yet.
          </EmptyState>
        ) : (
          rows
        )}
      </div>
      {extra.map(row)}
    </div>
  );
}

/** The next three days as cards, each with its first events and dinner. */
function Upcoming({
  className,
  today,
  events,
  meals,
  onDay,
  perDay,
}: {
  className: string;
  today: Date;
  events: CalendarEvent[];
  meals: Map<string, Meal[]>;
  onDay: (day: Date) => void;
  perDay: number;
}) {
  const boot = useBootstrap();
  return (
    <div className={`upcoming${className}`}>
      {[1, 2, 3].map((n) => {
        const d = addDays(today, n);
        const es = eventsOn(events, d);
        const meal = boot.flags.meals ? mainMeal(meals.get(toIsoDate(d))) : undefined;
        return (
          <button key={n} className="d" onClick={() => onDay(d)}>
            <div className="dh">
              <b>{n === 1 ? 'Tomorrow' : dayNames[d.getDay()]}</b>
              <span className="tnum">
                {monthNames[d.getMonth()]!.slice(0, 3)} {d.getDate()}
              </span>
            </div>
            {es.slice(0, perDay).map((e) => (
              <div key={e.id} className="r" style={pc(e.color)}>
                <i />
                {e.allDay ? 'All day' : formatTime(new Date(e.start))} · {e.title}
              </div>
            ))}
            {es.length > perDay && <div className="r more">+{es.length - perDay} more</div>}
            {es.length === 0 && <div className="r none">Nothing planned</div>}
            {meal && (
              <div className="r meal">
                <Svg>{Icon.meal}</Svg>
                {meal.title}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
