/**
 * The Grid preset: six weeks from the Sunday before the 1st, three pills a day plus "+n more",
 * paging with the arrows or a swipe, and the day sheet on tap.
 */
import type { CalendarEvent } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNow } from '../../app/Clock';
import { eventsOn, formatTime, monthNames, useEvents } from '../today/calendar';
import { Icon, Svg, pc } from '../today/parts';
import { useDaySheet } from './DaySheet';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EASE = [0.2, 0.8, 0.2, 1] as const;

/** The first cell of the grid: the Sunday on or before the 1st. */
export function gridStart(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  return addDays(first, -first.getDay());
}

export function MonthGrid() {
  const now = useNow(60_000);
  const today = startOfDay(now);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [dir, setDir] = useState(0);
  const [selected, setSelected] = useState<Date | null>(null);
  const reduce = useReducedMotion();
  const openDay = useDaySheet();
  const select = (d: Date) => {
    setSelected(d);
    openDay(d, { onClosed: () => setSelected((s) => (s?.getTime() === d.getTime() ? null : s)) });
  };

  const wrap = useRef<HTMLDivElement>(null);
  const fit = usePillCapacity(wrap);

  const start = gridStart(view);
  const { events } = useEvents(start, addDays(start, 42));

  const go = (n: number) => {
    setDir(n);
    setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  };
  const goToday = () => {
    const target = new Date(today.getFullYear(), today.getMonth(), 1);
    if (target.getTime() === view.getTime()) return;
    setDir(target > view ? 1 : -1);
    setView(target);
  };
  const onSwipe = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 80 || Math.abs(info.offset.x) < Math.abs(info.offset.y)) return;
    go(info.offset.x < 0 ? 1 : -1);
  };

  const slide = reduce ? 0 : 40;
  return (
    <div className="mgrid">
      <div className="head">
        <h1 className="title">
          <span>{monthNames[view.getMonth()]}</span>
          <span className="yr tnum">{view.getFullYear()}</span>
        </h1>
        <div className="navbtns">
          <button aria-label="Previous month" onClick={() => go(-1)}>
            <Svg>{Icon.prev}</Svg>
          </button>
          <button className="today-btn" onClick={goToday}>
            Today
          </button>
          <button aria-label="Next month" onClick={() => go(1)}>
            <Svg>{Icon.next}</Svg>
          </button>
        </div>
      </div>
      <div className="wdh" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="gridwrap" ref={wrap}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={toIsoDate(view)}
            className="grid"
            role="grid"
            aria-label={`${monthNames[view.getMonth()]} ${view.getFullYear()}`}
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
            {Array.from({ length: 42 }, (_, i) => {
              const d = addDays(start, i);
              return (
                <DayCell
                  key={i}
                  day={d}
                  out={d.getMonth() !== view.getMonth()}
                  isToday={d.getTime() === today.getTime()}
                  selected={selected?.getTime() === d.getTime()}
                  events={eventsOn(events, d)}
                  fit={fit}
                  onOpen={() => select(d)}
                />
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function DayCell({
  day,
  out,
  isToday,
  selected,
  events,
  fit,
  onOpen,
}: {
  day: Date;
  out: boolean;
  isToday: boolean;
  selected: boolean;
  events: CalendarEvent[];
  /** Rows of pills that fit in a cell, the "+n more" row included. */
  fit: number;
  onOpen: () => void;
}) {
  const cls = ['cell', out && 'out', isToday && 'is-today', selected && 'sel']
    .filter(Boolean)
    .join(' ');
  const shown = events.length <= fit ? events : events.slice(0, Math.max(1, fit - 1));
  return (
    <button
      className={cls}
      role="gridcell"
      aria-label={`${monthNames[day.getMonth()]} ${day.getDate()}, ${events.length} events`}
      onClick={onOpen}
    >
      <span className="n tnum">{day.getDate()}</span>
      {shown.map((e) => (
        <span key={e.id} className="pill" style={pc(e.color)}>
          {!e.allDay && new Date(e.start) >= day && (
            <span className="tnum">{formatTime(new Date(e.start), true)} </span>
          )}
          {e.title}
        </span>
      ))}
      {events.length > shown.length && (
        <span className="pill more">+{events.length - shown.length} more</span>
      )}
    </button>
  );
}

/* A cell is 6px padding, a 26px date and 3px gaps; each pill row is 20px plus a gap. */
const CELL_CHROME = 6 + 26;
const PILL_ROW = 23;
const GAP = 8;

/** How many pill rows fit in a day cell at the current grid height (3 before it is measured). */
function usePillCapacity(ref: React.RefObject<HTMLDivElement | null>): number {
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cell = (el.clientHeight - 5 * GAP) / 6;
      setFit(Math.max(1, Math.floor((cell - CELL_CHROME) / PILL_ROW)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}
