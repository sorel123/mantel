/**
 * Quick add, inside the day sheet: a title, the day (a week of chips, or any date from the month
 * picker), all day or a start time with a length or an end time, how it repeats, who it is for,
 * where, a countdown star, and (when there is a choice) which calendar. Big targets, few words.
 * With `event` it edits that event instead, with a Delete button; for one occurrence of a
 * repeating event, saving and deleting ask "this one or all".
 */
import type { CalendarEvent, EditScope, Repeat } from '@mantel/shared';
import { addDays, startOfDay, toLocalIso } from '@mantel/shared';
import { useState, type FormEvent } from 'react';
import { useOverlay } from '../../app/overlay';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { dayNames, monthNames, relativeDay } from '../today/calendar';
import { Avatar, Icon, Svg, pc } from '../today/parts';
import { DatePicker } from './DatePicker';
import { looksRoutable, tidyPlace } from './place';

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const fromMinutes = (n: number) => {
  const m = ((n % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const lengthLabel = (m: number) =>
  m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`;
const DAY_MS = 864e5;

const LENGTHS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
  { label: '3 hr', minutes: 180 },
];

/** The repeat chips, worded for the chosen day ("Every Tue"). */
export function repeatChoices(date: Date): Array<{ value: Repeat | null; label: string }> {
  return [
    { value: null, label: 'Once' },
    { value: 'daily', label: 'Every day' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'weekly', label: `Every ${dayNames[date.getDay()]!.slice(0, 3)}` },
    { value: 'monthly', label: `Monthly on the ${ordinal(date.getDate())}` },
  ];
}
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** The next whole hour on `day` if it is today, else 9 am. */
function defaultTime(day: Date, now: Date): string {
  const isToday = startOfDay(day).getTime() === startOfDay(now).getTime();
  const h = isToday ? Math.min(23, now.getHours() + 1) : 9;
  return `${String(h).padStart(2, '0')}:00`;
}

export function QuickAdd({
  day,
  event,
  onDone,
  onCancel,
  now = new Date(),
}: {
  day: Date;
  /** Edit this event rather than adding one. */
  event?: CalendarEvent;
  onDone: () => void;
  onCancel: () => void;
  now?: Date;
}) {
  const boot = useBootstrap();
  const { confirm } = useOverlay();
  const writable = boot.calendars.filter((c) => !c.readOnly && !c.isMeals);
  const evStart = event ? new Date(event.start) : null;
  const evMinutes = event
    ? Math.max(15, Math.round((new Date(event.end).getTime() - evStart!.getTime()) / 60_000))
    : 60;
  // An all-day event keeps its number of days when it moves.
  const evDays = event?.allDay ? Math.max(1, Math.round((evMinutes * 60_000) / DAY_MS)) : 1;
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(startOfDay(evStart ?? day));
  const [picking, setPicking] = useState(false);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [time, setTime] = useState(() =>
    evStart && !event!.allDay ? hhmm(evStart) : defaultTime(day, now),
  );
  const [minutes, setMinutes] = useState(event && !event.allDay ? evMinutes : 60);
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [who, setWho] = useState<string[]>(event?.personIds ?? []);
  const [place, setPlace] = useState(event?.location ?? '');
  const [countdown, setCountdown] = useState(event?.countdown ?? false);
  const [calendarId, setCalendarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** For a repeating event: waiting on "this one or all" before saving or deleting. */
  const [ask, setAsk] = useState<'save' | 'delete' | null>(null);

  const first = startOfDay(event ? addDays(evStart!, -1) : day);
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(first, n));
  const offStrip = !days.some((d) => d.getTime() === date.getTime());
  const lengths =
    !LENGTHS.some((l) => l.minutes === minutes) && minutes > 0
      ? [...LENGTHS, { label: lengthLabel(minutes), minutes }].sort((a, b) => a.minutes - b.minutes)
      : LENGTHS;
  const endTime = fromMinutes(toMinutes(time) + minutes);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAsk(null);
    } finally {
      setBusy(false);
    }
  };

  function times() {
    const [h, m] = time.split(':').map(Number) as [number, number];
    const start = new Date(date);
    if (!allDay) start.setHours(h, m, 0, 0);
    const end = allDay
      ? addDays(start, event?.allDay ? evDays : 1)
      : new Date(start.getTime() + minutes * 60_000);
    return { start: toLocalIso(start), end: toLocalIso(end), allDay };
  }

  async function save(scope?: EditScope) {
    const where = tidyPlace(place);
    await run(() =>
      event
        ? api.call('calendarEventPatch', {
            params: { id: event.id },
            body: {
              title: title.trim(),
              ...times(),
              ...(who.join() !== event.personIds.join() ? { personIds: who } : {}),
              ...(where !== (event.location ?? '') ? { location: where } : {}),
              ...(countdown !== event.countdown ? { countdown } : {}),
              ...(scope ? { scope } : {}),
            },
          })
        : api.call('calendarQuick', {
            body: {
              title: title.trim(),
              ...times(),
              ...(who.length ? { personIds: who } : {}),
              ...(calendarId ? { calendarId } : {}),
              ...(where ? { location: where } : {}),
              ...(repeat ? { repeat } : {}),
              ...(countdown ? { countdown: true } : {}),
            },
          }),
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    if (event?.recurring) return setAsk('save');
    await save();
  }

  async function remove(scope?: EditScope) {
    if (!event || busy) return;
    if (event.recurring && !scope) return setAsk('delete');
    if (!event.recurring) {
      const ok = await confirm({
        title: `Delete ${event.title}?`,
        body: 'It goes from the calendar everywhere, not just from the wall.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() =>
      api.call('calendarEventDelete', {
        params: { id: event.id },
        query: scope ? { scope } : {},
      }),
    );
  }

  const toggle = (id: string) =>
    setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

  if (event && ask) {
    const verb = ask === 'save' ? 'Change' : 'Delete';
    return (
      <div className="qa qa-ask" role="group" aria-label={`${verb} which?`}>
        <p className="h3">
          {event.title} repeats. {verb} just this one, or every one?
        </p>
        {ask === 'delete' && (
          <p className="muted">It goes from the calendar everywhere, not just from the wall.</p>
        )}
        {error && (
          <p className="qa-err" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className={ask === 'delete' ? 'qa-delete block' : 'addbtn'}
          disabled={busy}
          onClick={() => void (ask === 'save' ? save('one') : remove('one'))}
        >
          {verb} this one
        </button>
        <button
          type="button"
          className={ask === 'delete' ? 'qa-delete block' : 'addbtn'}
          disabled={busy}
          onClick={() => void (ask === 'save' ? save('all') : remove('all'))}
        >
          {verb} all of them
        </button>
        <button type="button" className="qa-cancel" onClick={() => setAsk(null)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <form className="qa" onSubmit={submit}>
      <input
        className="qa-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's happening?"
        aria-label="Event title"
        autoFocus={!event}
        enterKeyHint="done"
      />

      <div className="qa-group" role="group" aria-label="Day">
        {days.map((d) => (
          <button
            type="button"
            key={d.toISOString()}
            className="chip"
            aria-pressed={d.getTime() === date.getTime()}
            onClick={() => {
              setDate(d);
              setPicking(false);
            }}
          >
            {relativeDay(d, now)}
          </button>
        ))}
        {offStrip && (
          <button type="button" className="chip" aria-pressed onClick={() => setPicking((p) => !p)}>
            {dayNames[date.getDay()]!.slice(0, 3)}, {monthNames[date.getMonth()]!.slice(0, 3)}{' '}
            {date.getDate()}
          </button>
        )}
        <button
          type="button"
          className="chip qa-more"
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          <Svg>{Icon.month}</Svg>
          {picking ? 'Close' : 'Other date'}
        </button>
      </div>
      {picking && (
        <DatePicker
          value={date}
          today={now}
          {...(event ? {} : { earliest: now })}
          onPick={(d) => {
            setDate(d);
            setPicking(false);
          }}
        />
      )}

      <div className="qa-group" role="group" aria-label="Time">
        <button
          type="button"
          className="chip"
          aria-pressed={allDay}
          onClick={() => setAllDay(true)}
        >
          All day
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={!allDay}
          onClick={() => setAllDay(false)}
        >
          At a time
        </button>
        {!allDay && (
          <input
            type="time"
            className="qa-time tnum"
            step={300}
            value={time}
            onChange={(e) => e.target.value && setTime(e.target.value)}
            aria-label="Start time"
          />
        )}
      </div>

      {!allDay && (
        <div className="qa-group" role="group" aria-label="Length">
          {lengths.map((l) => (
            <button
              type="button"
              key={l.minutes}
              className="chip"
              aria-pressed={minutes === l.minutes}
              onClick={() => setMinutes(l.minutes)}
            >
              {l.label}
            </button>
          ))}
          <label className="qa-until">
            <span>Until</span>
            <input
              type="time"
              className="qa-time tnum"
              step={300}
              value={endTime}
              onChange={(e) => {
                if (!e.target.value) return;
                // Earlier than the start means it ends the next morning.
                const m = toMinutes(e.target.value) - toMinutes(time);
                setMinutes(m <= 0 ? m + 1440 : m);
              }}
              aria-label="End time"
            />
          </label>
        </div>
      )}

      {!event && (
        <div className="qa-group" role="group" aria-label="Repeat">
          {repeatChoices(date).map((r) => (
            <button
              type="button"
              key={r.value ?? 'once'}
              className="chip"
              aria-pressed={repeat === r.value}
              onClick={() => setRepeat(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="qa-group" role="group" aria-label="Who">
        {boot.people.map((p) => (
          <button
            type="button"
            key={p.id}
            className="chip who"
            style={pc(p.color)}
            aria-pressed={who.includes(p.id)}
            onClick={() => toggle(p.id)}
          >
            <Avatar person={p} small />
            {p.name}
          </button>
        ))}
      </div>

      <div className="qa-where">
        <input
          className="qa-place"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          onPaste={(e) => {
            // An address copied from Maps comes in on several lines; keep it on one.
            const text = e.clipboardData.getData('text');
            if (!/\n/.test(text)) return;
            e.preventDefault();
            setPlace(tidyPlace(text));
          }}
          placeholder="Where (optional)"
          aria-label="Place"
          enterKeyHint="done"
        />
        {boot.flags.commute && !allDay && looksRoutable(place) && (
          <span className="qa-hint">Gets a leave-by time on the day</span>
        )}
      </div>

      <div className="qa-group">
        <button
          type="button"
          className="chip qa-star"
          aria-pressed={countdown}
          onClick={() => setCountdown((c) => !c)}
        >
          <Svg>{Icon.star}</Svg>
          {countdown ? 'Counting down on Today' : 'Count down to it'}
        </button>
      </div>

      {!event && writable.length > 1 && (
        <label className="qa-cal">
          <span className="eyebrow">Calendar</span>
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            <option value="">Default</option>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="qa-err" role="alert">
          {error}
        </p>
      )}
      <div className="qa-actions">
        {event && (
          <button type="button" className="qa-delete" onClick={() => void remove()} disabled={busy}>
            Delete
          </button>
        )}
        <button type="button" className="qa-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="addbtn" disabled={!title.trim() || busy}>
          {event ? (busy ? 'Saving…' : 'Save') : busy ? 'Adding…' : 'Add to calendar'}
        </button>
      </div>
    </form>
  );
}
