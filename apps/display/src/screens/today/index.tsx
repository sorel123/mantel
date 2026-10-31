/**
 * Today: the date with countdown chips, weather and grocery slots, tonight's meal, and the
 * agenda card with all-day bands, a timeline with the now line, and the next three days.
 */
import type { CalendarEvent, Meal } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../../app/Clock';
import { useBootstrap } from '../../lib/bootstrap';
import { DaySheet } from '../month/DaySheet';
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

export function TodayScreen() {
  const now = useNow(30_000);
  const today = startOfDay(now);
  const boot = useBootstrap();
  const { events } = useEvents(today, addDays(today, 4));
  const [sheet, setSheet] = useState<{ day: Date; add: boolean } | null>(null);

  return (
    <div className="cal today">
      <div className="col">
        <div className="datebox">
          <div className="wd">{dayNames[today.getDay()]}</div>
          <div className="big">
            <span className="dn tnum">{today.getDate()}</span>
            <span className="mo">{monthNames[today.getMonth()]}</span>
          </div>
          {boot.flags.countdowns && <Countdowns />}
        </div>
        {/* WS4's weather card goes here in the integration pass. */}
        <div className="card slot" data-slot="weather">
          <span className="eyebrow">Weather</span>
        </div>
        {boot.flags.meals && <MealStrip today={today} />}
        {/* WS5's grocery peek goes here in the integration pass. */}
        <div className="card slot grow" data-slot="grocery">
          <span className="eyebrow">Grocery</span>
        </div>
      </div>
      <div className="col">
        <Agenda
          now={now}
          events={events}
          onAdd={() => setSheet({ day: today, add: true })}
          onDay={(day) => setSheet({ day, add: false })}
        />
      </div>
      <DaySheet day={sheet?.day ?? null} startWithAdd={sheet?.add} onClose={() => setSheet(null)} />
    </div>
  );
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

function MealStrip({ today }: { today: Date }) {
  const thisWeek = useMeals(today);
  const later = useMeals(addDays(today, 3));
  const meals = useMemo(() => {
    const seen = new Set<string>();
    return [...thisWeek.meals, ...later.meals].filter((m) => {
      const k = `${m.date}|${m.slot}|${m.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [thisWeek, later]);
  const iso = toIsoDate(today);
  const todays = meals.filter((m) => m.date === iso);
  const dinner = todays.find((m) => m.slot === 'dinner') ?? todays[todays.length - 1];
  const others = todays.filter((m) => m !== dinner);
  const next = [1, 2, 3].map((n) => {
    const d = addDays(today, n);
    const ms = meals.filter((m) => m.date === toIsoDate(d));
    return { d, meal: ms.find((m) => m.slot === 'dinner') ?? ms[0] };
  });

  return (
    <div className="card meals" aria-label="Meal plan">
      <div className="tonight">
        <Svg>{Icon.meal}</Svg>
        <div>
          <span className="eyebrow">
            {dinner?.slot === 'dinner' || !dinner ? 'Tonight' : slotWord[dinner.slot]}
          </span>
          <b className={dinner ? '' : 'none'}>{dinner?.title ?? 'Nothing planned'}</b>
          {others.length > 0 && (
            <span className="also">
              {others.map((m) => `${slotWord[m.slot]}: ${m.title}`).join(' · ')}
            </span>
          )}
        </div>
      </div>
      <div className="nextmeals">
        {next.map(({ d, meal }) => (
          <div key={d.toISOString()}>
            <span>{dayNames[d.getDay()]!.slice(0, 3)}</span>
            <b className={meal ? '' : 'none'}>{meal?.title ?? '—'}</b>
          </div>
        ))}
      </div>
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
  const todays = eventsOn(events, today);
  const allDay = todays.filter((e) => e.allDay);
  const timed = todays.filter((e) => !e.allDay);
  const t = now.getTime();
  const nowIndex = timed.findIndex((e) => new Date(e.start).getTime() > t);
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
    return <EventRow key={e.id} event={e} day={today} state={state} />;
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
      <div className="tl" ref={tl}>
        {rows}
      </div>
      <div className="upcoming">
        {[1, 2, 3].map((n) => {
          const d = addDays(today, n);
          const es = eventsOn(events, d);
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
