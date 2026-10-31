/**
 * The agenda card: all-day bands, countdown chips, a timeline with the now line and leave-by
 * chips, tonight's meal, and (in the full variant) the next three days with their dinners.
 */
import type { CalendarEvent, Meal } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { useLayoutEffect, useMemo, useRef } from 'react';
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
  variant = 'full',
}: {
  now: Date;
  events: CalendarEvent[];
  onAdd: () => void;
  onDay: (day: Date) => void;
  /** `short` leaves out the next three days, for presets that give the agenda less room. */
  variant?: 'full' | 'short';
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

  return (
    <div className={`card agenda${variant === 'short' ? ' short' : ''}`}>
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
      {boot.flags.countdowns && <Countdowns />}
      <div className="tl" ref={tl}>
        {boot.calendars.length === 0 ? (
          <EmptyState icon={EmptyIcon.calendar} action="Connect a calendar" section="calendars">
            No calendars connected yet.
          </EmptyState>
        ) : (
          rows
        )}
      </div>
      {boot.flags.meals && <Tonight meals={meals.get(toIsoDate(today))} />}
      {variant === 'full' && (
        <div className="upcoming">
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
                {es.slice(0, 2).map((e) => (
                  <div key={e.id} className="r" style={pc(e.color)}>
                    <i />
                    {e.allDay ? 'All day' : formatTime(new Date(e.start))} · {e.title}
                  </div>
                ))}
                {es.length > 2 && <div className="r more">+{es.length - 2} more</div>}
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
      )}
    </div>
  );
}
