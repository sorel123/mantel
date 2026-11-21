import type { Digest, Person } from '@mantel/shared';
import { motion } from 'framer-motion';
import { EASE, STD, useMotionPreference } from '../../app/motion';
import { PluginIcon } from '../plugins';
import './digest.css';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The wall-clock time in an ISO string with an offset, as the household reads it: "2:30 PM". */
export function clockOf(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "since Tuesday" for a date in the last week, else "since Nov 12". */
export function sinceLabel(date: string, today: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, mo - 1, d, 12));
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(ty, tm - 1, td, 12) - at.getTime()) / 864e5);
  if (days === 1) return 'since yesterday';
  if (days > 1 && days < 7) return `since ${DAYS[at.getUTCDay()]}`;
  return `since ${MONTHS[mo - 1]!.slice(0, 3)} ${d}`;
}

function dateTitle(date: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, mo - 1, d, 12));
  return `${DAYS[at.getUTCDay()]}, ${MONTHS[mo - 1]} ${d}`;
}

/** A digest, laid out to read in ten seconds: the day, then each part as a short card. */
export function DigestView({ digest, people }: { digest: Digest; people: Person[] }) {
  const reduced = useMotionPreference();
  const color = (ids: string[]) => people.find((p) => p.id === ids[0])?.color;
  const open = digest.chores.filter((c) => !c.done);
  const done = digest.chores.filter((c) => c.done);
  const parts: Array<{ key: string; node: JSX.Element }> = [];

  if (digest.weather)
    parts.push({
      key: 'weather',
      node: (
        <section className={`dg-card dg-weather${digest.weather.warning ? ' warn' : ''}`}>
          <PluginIcon name={digest.weather.warning ? 'alert' : 'info'} />
          <div>
            <b>{digest.weather.line}</b>
            {digest.weather.warning && <span>{digest.weather.warning}</span>}
          </div>
        </section>
      ),
    });

  parts.push({
    key: 'events',
    node: (
      <section className="dg-card" aria-label="Events">
        <h2 className="eyebrow">{digest.kind === 'evening' ? 'Tomorrow' : 'Today'}</h2>
        {digest.events.length ? (
          <ul className="dg-events">
            {digest.events.map((e) => (
              <li
                key={e.id}
                style={{ '--pc': e.color ?? color(e.personIds) } as React.CSSProperties}
              >
                <a href={`#calendar/${encodeURIComponent(e.id)}`} className="dg-event">
                  <span className="dg-time tnum">{e.allDay ? 'All day' : clockOf(e.start)}</span>
                  <span className="dg-title">
                    <b>{e.title}</b>
                    {e.location && <small>{e.location}</small>}
                    {e.leaveBy && (
                      <span className="pill dg-leave tnum">Leave {clockOf(e.leaveBy)}</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dg-empty">Nothing on the calendar. Enjoy it.</p>
        )}
      </section>
    ),
  });

  if (digest.chores.length)
    parts.push({
      key: 'chores',
      node: (
        <section className="dg-card" aria-label="Chores">
          <h2 className="eyebrow">Chores · {open.length ? `${open.length} to do` : 'all done'}</h2>
          <ul className="dg-chores">
            {[...open, ...done].map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <a href={`#chores/${encodeURIComponent(c.id)}`}>
                  <span className="cb" aria-hidden>
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <span className="dg-title">{c.title}</span>
                  {c.overdueSince && !c.done && (
                    <span className="pill dg-since">{sinceLabel(c.overdueSince, digest.date)}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ),
    });

  parts.push({
    key: 'dinner',
    node: (
      <a className="dg-card dg-row" href={`#meals/${digest.date}`}>
        <PluginIcon name="leaf" />
        <span>
          {digest.dinner ? (
            <>
              Dinner: <b>{digest.dinner}</b>
            </>
          ) : (
            <>Dinner is not planned yet. Tap to pick something.</>
          )}
        </span>
      </a>
    ),
  });

  for (const b of digest.birthdays)
    parts.push({
      key: `b-${b}`,
      node: (
        <section className="dg-card dg-row good">
          <PluginIcon name="star" />
          <span>
            <b>{b}</b>'s birthday
          </span>
        </section>
      ),
    });
  digest.alerts.forEach((a, i) =>
    parts.push({
      key: `a-${i}`,
      node: (
        <section className={`dg-card dg-row ${a.tone}`}>
          <PluginIcon name={a.icon} />
          <span>{a.text}</span>
        </section>
      ),
    }),
  );

  return (
    <article className="digest" data-testid="digest">
      <header className="dg-head">
        <span className="eyebrow">{dateTitle(digest.date)}</span>
        <h1 className="h1 dg-greeting">{digest.greeting}</h1>
        <p className="dg-headline">{digest.summary ?? digest.headline}</p>
      </header>
      {parts.map((p, i) => (
        <motion.div
          key={p.key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0 } : { duration: STD, ease: EASE, delay: i * 0.05 }}
        >
          {p.node}
        </motion.div>
      ))}
    </article>
  );
}

/** The page's loading state: the same shape, in skeletons. */
export function DigestSkeleton() {
  return (
    <div className="digest" aria-busy="true" aria-label="Loading your day">
      <div className="skeleton" style={{ height: 18, width: '40%' }} />
      <div className="skeleton" style={{ height: 40, width: '75%' }} />
      <div className="skeleton dg-skel-card" />
      <div className="skeleton dg-skel-card tall" />
      <div className="skeleton dg-skel-card" />
    </div>
  );
}
