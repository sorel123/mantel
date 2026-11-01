/**
 * The Grid preset: the weeks of the month from the Sunday before the 1st (four to six), events
 * that cover several days as bars across the week, as many pills a day as fit plus "+n more",
 * paging with the arrows or a swipe, and the day sheet on tap. Roomy or Compact per the layout
 * setting (`?density=compact` on the address).
 */
import { addDays, startOfDay, toIsoDate } from '@mantel/shared';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNow } from '../../app/Clock';
import { useLayout } from '../../app/layout';
import { formatTime, monthNames, useEvents } from '../today/calendar';
import { Icon, Svg, pc } from '../today/parts';
import { fillDay, layoutWeeks, weeksIn, type Bar, type WeekLayout } from './bars';
import { useDaySheet } from './DaySheet';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EASE = [0.2, 0.8, 0.2, 1] as const;

/** The first cell of the grid: the Sunday on or before the 1st. */
export function gridStart(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  return addDays(first, -first.getDay());
}

export function MonthGrid({ toggle }: { toggle?: React.ReactNode }) {
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

  const density = useLayout().monthDensity ?? 'roomy';
  const start = gridStart(view);
  const weeks = weeksIn(view);
  const wrap = useRef<HTMLDivElement>(null);
  const fit = usePillCapacity(wrap, weeks, density);

  const { events } = useEvents(start, addDays(start, weeks * 7));
  const laid = useMemo(() => layoutWeeks(start, weeks, events), [start.getTime(), weeks, events]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className={`mgrid ${density}`}>
      <div className="head">
        <h1 className="title">
          <span>{monthNames[view.getMonth()]}</span>
          <span className="yr tnum">{view.getFullYear()}</span>
        </h1>
        <div className="navbtns">
          {toggle}
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
            style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
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
            {laid.flatMap((week, w) => [
              ...Array.from({ length: 7 }, (_, c) => {
                const d = addDays(start, w * 7 + c);
                return (
                  <DayCell
                    key={`d${w * 7 + c}`}
                    day={d}
                    row={w}
                    col={c}
                    week={week}
                    out={d.getMonth() !== view.getMonth()}
                    isToday={d.getTime() === today.getTime()}
                    selected={selected?.getTime() === d.getTime()}
                    fit={fit}
                    onOpen={() => select(d)}
                  />
                );
              }),
              ...week.bars
                .filter((b) => b.lane < Math.max(1, fit - 1))
                .map((b) => (
                  <WeekBar
                    key={`b${w}-${b.event.id}-${b.from}`}
                    bar={b}
                    row={w}
                    start={addDays(start, w * 7)}
                  />
                )),
            ])}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function DayCell({
  day,
  row,
  col,
  week,
  out,
  isToday,
  selected,
  fit,
  onOpen,
}: {
  day: Date;
  row: number;
  col: number;
  week: WeekLayout;
  out: boolean;
  isToday: boolean;
  selected: boolean;
  /** Rows of pills that fit in a cell, bars and the "+n more" row included. */
  fit: number;
  onOpen: () => void;
}) {
  const cls = ['cell', out && 'out', isToday && 'is-today', selected && 'sel']
    .filter(Boolean)
    .join(' ');
  const { lanes, pills, more } = fillDay(week, col, fit);
  const total =
    week.bars.filter((b) => b.from <= col && b.to >= col).length + week.singles[col]!.length;
  return (
    <button
      className={cls}
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      role="gridcell"
      aria-label={`${monthNames[day.getMonth()]} ${day.getDate()}, ${total} events`}
      onClick={onOpen}
    >
      <span className="n tnum">{day.getDate()}</span>
      {lanes > 0 && (
        <span className="lanes" aria-hidden="true" style={{ '--lanes': lanes } as CSSProperties} />
      )}
      {pills.map((e) => (
        <span key={e.id} className="pill" style={pc(e.color)}>
          {!e.allDay && new Date(e.start) >= day && (
            <span className="tnum">{formatTime(new Date(e.start), true)} </span>
          )}
          {e.title}
        </span>
      ))}
      {more > 0 && <span className="pill more">+{more} more</span>}
    </button>
  );
}

/** One week's piece of an event that covers several days, drawn over the day cells. */
function WeekBar({ bar, row, start }: { bar: Bar; row: number; start: Date }) {
  const e = bar.event;
  const cls = ['pill', 'bar', bar.before && 'before', bar.after && 'after']
    .filter(Boolean)
    .join(' ');
  const timed = !e.allDay && !bar.before && new Date(e.start) >= addDays(start, bar.from);
  return (
    <span
      className={cls}
      aria-hidden="true"
      style={
        {
          ...pc(e.color),
          gridRow: row + 1,
          gridColumn: `${bar.from + 1} / ${bar.to + 2}`,
          '--lane': bar.lane,
        } as CSSProperties
      }
    >
      {timed && <span className="tnum">{formatTime(new Date(e.start), true)} </span>}
      {e.title}
    </span>
  );
}

/** A CSS length variable on `el`, in pixels (the grid's metrics live in month.css). */
const px = (style: CSSStyleDeclaration, name: string, fallback: number) => {
  const n = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * How many pill rows (bars and "+n more" included) fit in a day cell at the current grid height,
 * from the metrics month.css sets for the density. 3 before it is measured.
 */
function usePillCapacity(
  ref: React.RefObject<HTMLDivElement | null>,
  weeks: number,
  density: string,
): number {
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const st = getComputedStyle(el);
      const gap = px(st, '--m-cell-gap', 8);
      const pad = px(st, '--m-pad', 6);
      const num = px(st, '--m-num', 26);
      const row = px(st, '--m-pill', 20) + px(st, '--m-gap', 3);
      const cell = (el.clientHeight - (weeks - 1) * gap) / weeks;
      setFit(Math.max(1, Math.floor((cell - 2 * pad - num - 2) / row)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref, weeks, density]);
  return fit;
}
