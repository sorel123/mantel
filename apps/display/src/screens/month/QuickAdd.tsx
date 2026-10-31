/**
 * Quick add, inside the day sheet: a title, the day, all day or a start time and length,
 * who it is for, and (when there is a choice) which calendar. Big targets, few fields.
 */
import { addDays, startOfDay, toLocalIso } from '@mantel/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { relativeDay } from '../today/calendar';
import { Avatar, pc } from '../today/parts';

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
  onDone,
  onCancel,
  now = new Date(),
}: {
  day: Date;
  onDone: () => void;
  onCancel: () => void;
  now?: Date;
}) {
  const boot = useBootstrap();
  const writable = boot.calendars.filter((c) => !c.readOnly && !c.isMeals);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(startOfDay(day));
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState(() => defaultTime(day, now));
  const [minutes, setMinutes] = useState(60);
  const [who, setWho] = useState<string[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(startOfDay(day), n));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const [h, m] = time.split(':').map(Number) as [number, number];
    const start = new Date(date);
    if (!allDay) start.setHours(h, m, 0, 0);
    const end = allDay ? addDays(start, 1) : new Date(start.getTime() + minutes * 60_000);
    setBusy(true);
    setError(null);
    try {
      await api.call('calendarQuick', {
        body: {
          title: title.trim(),
          start: toLocalIso(start),
          end: toLocalIso(end),
          allDay,
          ...(who.length ? { personIds: who } : {}),
          ...(calendarId ? { calendarId } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
        autoFocus
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
          {LENGTHS.map((l) => (
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

      {writable.length > 1 && (
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
        <button type="button" className="qa-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="addbtn" disabled={!title.trim() || busy}>
          {busy ? 'Adding…' : 'Add to calendar'}
        </button>
      </div>
    </form>
  );
}
