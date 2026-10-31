/**
 * The Week strip preset: seven days, Sunday to Saturday, each with everything in it. Arrows or
 * a swipe move a week; the day's header opens the day sheet.
 */
import type { CalendarEvent } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useState } from 'react';
import { useNow } from '../../app/Clock';
import {
  dayNames,
  eventsOn,
  formatTime,
  monthNames,
  spanLabel,
  useEvents,
} from '../today/calendar';
import { Avatars, Icon, Svg, pc } from '../today/parts';
import { useDaySheet } from './DaySheet';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** The Sunday on or before `day`. */
export const weekStart = (day: Date) => addDays(startOfDay(day), -day.getDay());

/** "November 2 to 8" or "November 29 to December 5". */
export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const m1 = monthNames[start.getMonth()]!;
  const m2 = monthNames[end.getMonth()]!;
  return m1 === m2
    ? `${m1} ${start.getDate()} to ${end.getDate()}`
    : `${m1} ${start.getDate()} to ${m2} ${end.getDate()}`;
}

export function WeekStrip() {
  const now = useNow(60_000);
  const today = startOfDay(now);
  const [view, setView] = useState(() => weekStart(today));
  const [dir, setDir] = useState(0);
  const reduce = useReducedMotion();
  const openDay = useDaySheet();
  const { events } = useEvents(view, addDays(view, 7));

  const go = (n: number) => {
    setDir(n);
    setView((v) => addDays(v, 7 * n));
  };
  const goToday = () => {
    const target = weekStart(today);
    if (target.getTime() === view.getTime()) return;
    setDir(target > view ? 1 : -1);
    setView(target);
  };
  const onSwipe = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 80 || Math.abs(info.offset.x) < Math.abs(info.offset.y)) return;
    go(info.offset.x < 0 ? 1 : -1);
  };

  const slide = reduce ? 0 : 40;
  const thisWeek = view.getTime() === weekStart(today).getTime();
  return (
    <div className="wstrip">
      <div className="head">
        <h1 className="title">
          <span>{thisWeek ? 'This week' : weekLabel(view)}</span>
          {thisWeek && <span className="yr">{weekLabel(view)}</span>}
        </h1>
        <div className="navbtns">
          <button aria-label="Previous week" onClick={() => go(-1)}>
            <Svg>{Icon.prev}</Svg>
          </button>
          <button className="today-btn" onClick={goToday}>
            Today
          </button>
          <button aria-label="Next week" onClick={() => go(1)}>
            <Svg>{Icon.next}</Svg>
          </button>
        </div>
      </div>
      <div className="weekwrap">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={toIsoDate(view)}
            className="week"
            role="list"
            aria-label={`Week of ${weekLabel(view)}`}
            custom={dir}
            initial={{ x: dir * slide, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -dir * slide, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            onDragEnd={onSwipe}
          >
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(view, i);
              return (
                <DayColumn
                  key={i}
                  day={d}
                  now={now}
                  state={d < today ? 'past' : d.getTime() === today.getTime() ? 'today' : 'ahead'}
                  events={eventsOn(events, d)}
                  onOpen={() => openDay(d)}
                  onAdd={() => openDay(d, { add: true })}
                />
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  now,
  state,
  events,
  onOpen,
  onAdd,
}: {
  day: Date;
  now: Date;
  state: 'past' | 'today' | 'ahead';
  events: CalendarEvent[];
  onOpen: () => void;
  onAdd: () => void;
}) {
  const t = now.getTime();
  return (
    <section
      className={`card day ${state}`}
      role="listitem"
      aria-label={`${dayNames[day.getDay()]}, ${monthNames[day.getMonth()]} ${day.getDate()}, ${events.length} events`}
    >
      <button className="dh" onClick={onOpen}>
        <span className="wd">{dayNames[day.getDay()]!.slice(0, 3)}</span>
        <b className="n tnum">{day.getDate()}</b>
      </button>
      <div className="dlist">
        {events.length === 0 && <div className="dnone">Nothing planned</div>}
        {events.map((e) => {
          const s = new Date(e.start).getTime();
          const en = new Date(e.end).getTime();
          const when =
            state !== 'today' ? undefined : en <= t ? 'past' : s <= t ? 'now' : undefined;
          const span = spanLabel(e, day);
          return (
            <button
              key={e.id}
              className={`wev${when ? ` ${when}` : ''}${e.allDay ? ' allday' : ''}`}
              style={pc(e.color)}
              onClick={onOpen}
              data-testid="event"
            >
              <i />
              <span className="wt">
                {e.allDay ? (
                  <b>{span ?? 'All day'}</b>
                ) : (
                  <b className="tnum">{formatTime(new Date(e.start))}</b>
                )}
                {e.title}
              </span>
              <Avatars ids={e.personIds} small />
            </button>
          );
        })}
      </div>
      <button
        className="dadd"
        aria-label={`Add an event on ${dayNames[day.getDay()]}, ${monthNames[day.getMonth()]} ${day.getDate()}`}
        onClick={onAdd}
      >
        <Svg>{Icon.plus}</Svg>
      </button>
    </section>
  );
}
