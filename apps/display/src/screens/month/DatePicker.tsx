/**
 * A month of days to pick from, inside quick add: arrows page the month, today is ringed, the
 * chosen day is filled. Big targets, nothing else.
 */
import { addDays, startOfDay } from '@mantel/shared';
import { useState } from 'react';
import { monthNames } from '../today/calendar';
import { Icon, Svg } from '../today/parts';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DatePicker({
  value,
  today,
  earliest,
  onPick,
}: {
  value: Date;
  today: Date;
  /** Days before this can't be picked (quick add starts today; editing allows the past). */
  earliest?: Date;
  onPick: (day: Date) => void;
}) {
  const [view, setView] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const first = addDays(view, -view.getDay());
  const weeks = Math.ceil((view.getDay() + daysIn(view)) / 7);
  const t = startOfDay(today).getTime();
  const page = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  return (
    <div className="qa-picker" role="group" aria-label="Pick a date">
      <div className="qp-head">
        <button type="button" aria-label="Previous month" onClick={() => page(-1)}>
          <Svg>{Icon.prev}</Svg>
        </button>
        <b>
          {monthNames[view.getMonth()]} <span className="tnum">{view.getFullYear()}</span>
        </b>
        <button type="button" aria-label="Next month" onClick={() => page(1)}>
          <Svg>{Icon.next}</Svg>
        </button>
      </div>
      <div className="qp-grid">
        {WEEKDAYS.map((d, i) => (
          <span key={`h${i}`} className="qp-wd" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = addDays(first, i);
          const out = d.getMonth() !== view.getMonth();
          const chosen = d.getTime() === startOfDay(value).getTime();
          return (
            <button
              type="button"
              key={i}
              className={`qp-day tnum${out ? ' out' : ''}${d.getTime() === t ? ' today' : ''}`}
              aria-pressed={chosen}
              aria-label={`${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`}
              disabled={!!earliest && d.getTime() < startOfDay(earliest).getTime()}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const daysIn = (month: Date) => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
