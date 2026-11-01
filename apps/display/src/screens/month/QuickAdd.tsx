/**
 * Quick add, inside the day sheet: a title, the day, all day or a start time and length,
 * who it is for, and (when there is a choice) which calendar. Big targets, few fields.
 * With `event` it edits that event instead, with a place field and a Delete button.
 */
import type { CalendarEvent } from '@mantel/shared';
import { addDays, startOfDay, toLocalIso } from '@mantel/shared';
import { useState, type FormEvent } from 'react';
import { useOverlay } from '../../app/overlay';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { relativeDay } from '../today/calendar';
import { Avatar, pc } from '../today/parts';

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const lengthLabel = (m: number) =>
  m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`;
const DAY_MS = 864e5;

const LENGTHS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
  { label: '3 hr', minutes: 180 },
];

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
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [time, setTime] = useState(() =>
    evStart && !event!.allDay ? hhmm(evStart) : defaultTime(day, now),
  );
  const [minutes, setMinutes] = useState(event && !event.allDay ? evMinutes : 60);
  const [who, setWho] = useState<string[]>(event?.personIds ?? []);
  const [place, setPlace] = useState(event?.location ?? '');
  const [calendarId, setCalendarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = startOfDay(event ? addDays(evStart!, -1) : day);
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(first, n));
  const lengths =
    event && !event.allDay && !LENGTHS.some((l) => l.minutes === evMinutes)
      ? [...LENGTHS, { label: lengthLabel(evMinutes), minutes: evMinutes }].sort(
          (a, b) => a.minutes - b.minutes,
        )
      : LENGTHS;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const [h, m] = time.split(':').map(Number) as [number, number];
    const start = new Date(date);
    if (!allDay) start.setHours(h, m, 0, 0);
    const end = allDay
      ? addDays(start, event?.allDay ? evDays : 1)
      : new Date(start.getTime() + minutes * 60_000);
    const times = { start: toLocalIso(start), end: toLocalIso(end), allDay };
    await run(() =>
      event
        ? api.call('calendarEventPatch', {
            params: { id: event.id },
            body: {
              title: title.trim(),
              ...times,
              ...(who.join() !== event.personIds.join() ? { personIds: who } : {}),
              ...(place.trim() !== (event.location ?? '') ? { location: place.trim() } : {}),
            },
          })
        : api.call('calendarQuick', {
            body: {
              title: title.trim(),
              ...times,
              ...(who.length ? { personIds: who } : {}),
              ...(calendarId ? { calendarId } : {}),
            },
          }),
    );
  }

  async function remove() {
    if (!event || busy) return;
    const ok = await confirm({
      title: `Delete ${event.title}?`,
      body: 'It goes from the calendar everywhere, not just from the wall.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await run(() => api.call('calendarEventDelete', { params: { id: event.id } }));
  }

  const toggle = (id: string) =>
    setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

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
            onClick={() => setDate(d)}
          >
            {relativeDay(d, now)}
          </button>
        ))}
      </div>

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
            step={900}
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

      {event && (
        <input
          className="qa-place"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Where (optional)"
          aria-label="Place"
          enterKeyHint="done"
        />
      )}

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
