/**
 * Today: the date, WS4's weather card and WS5's grocery peek on the left; on the right the
 * agenda card with all-day bands, countdown chips, a timeline with the now line and leave-by
 * chips, tonight's meal, and the next three days with their dinners.
 */
import type { CalendarEvent, Meal } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { Component, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { registerAmbientSlot } from '../../app/ambient';
import { useNow } from '../../app/Clock';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { useNav } from '../../app/nav';
import {
  LeaveByChip,
  WeatherCard,
  matchLeaveBy,
  useCommute,
  useWeather,
} from '../../features/weather';
import { useBootstrap } from '../../lib/bootstrap';
import { GroceryPeek } from '../lists/GroceryPeek';
import { useDaySheet } from '../month/DaySheet';
import { AmbientNextEvent } from './AmbientNext';
import {
  countdownLabel,
  dayNames,
  eventsOn,
  formatTime,
  monthNames,
  spanLabel,
  useCountdowns,
  useEvents,
  useMeals,
} from './calendar';
import { Avatars, EventRow, Icon, Svg, pc } from './parts';
import './today.css';

// Ambient shows the next event under the weather line.
registerAmbientSlot({ id: 'next-event', Component: AmbientNextEvent, order: 1 });

export function TodayScreen() {
  const now = useNow(30_000);
  const today = startOfDay(now);
  const { events } = useEvents(today, addDays(today, 4));
  const openDay = useDaySheet();
  const nav = useNav();
  const weather = useWeather();

  return (
    <div className="cal today">
      <div className="col">
        <div className="datebox">
          <div className="wd">{dayNames[today.getDay()]}</div>
          <div className="big">
            <span className="dn tnum">{today.getDate()}</span>
            <span className="mo">{monthNames[today.getMonth()]}</span>
          </div>
        </div>
        <Guard name="weather">
          {weather.error && !weather.data ? (
            <div className="card weather">
              <EmptyState icon={EmptyIcon.weather} action="Set your location" section="home">
                No weather yet. Tell Mantel where home is.
              </EmptyState>
            </div>
          ) : (
            <WeatherCard now={now} />
          )}
        </Guard>
        <Guard name="grocery">
          <GroceryPeek onOpen={() => nav.go('lists')} />
        </Guard>
      </div>
      <div className="col">
        <Agenda
          now={now}
          events={events}
          onAdd={() => openDay(today, { add: true })}
          onDay={(day) => openDay(day)}
        />
      </div>
    </div>
  );
}

/**
 * Cards from other workstreams sit inside this, so one that throws leaves an empty slot
 * instead of taking the whole Today screen down.
 */
class Guard extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn(`Today: the ${this.props.name} card failed`, err);
  }
  override render() {
    return this.state.failed ? (
      <div className="card slot" data-slot={this.props.name} />
    ) : (
      this.props.children
    );
  }
}

function Countdowns() {
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

const slotWord: Record<Meal['slot'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  other: 'Snack',
};

/** Meals by date for today and the next three days (which can cross into next week). */
function useMealPlan(today: Date): Map<string, Meal[]> {
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

const mainMeal = (ms: Meal[] | undefined) => ms?.find((m) => m.slot === 'dinner') ?? ms?.at(-1);

function Tonight({ meals }: { meals: Meal[] | undefined }) {
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

function Agenda({
  now,
  events,
  onAdd,
  onDay,
}: {
  now: Date;
  events: CalendarEvent[];
  onAdd: () => void;
  onDay: (day: Date) => void;
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
    <div className="card agenda">
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
    </div>
  );
}
