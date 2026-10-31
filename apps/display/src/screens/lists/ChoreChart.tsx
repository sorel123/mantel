import type { Chore, Person } from '@mantel/shared';
import { Avatar } from './Avatar';
import { isComplete, todayIndex, type ChoreChart as Chart } from './data';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function Star({ filled = true, className = '' }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`star${filled ? ' on' : ''} ${className}`} aria-hidden>
      <path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" />
    </svg>
  );
}

/**
 * One card per child: this week's stars, then a row per chore with Monday to Sunday. Tapping a
 * row marks today's completion; tapping a finished row takes one back.
 */
export function ChoreChart({
  chart,
  people,
  onTap,
}: {
  chart: Chart;
  people: Person[];
  onTap: (chore: Chore) => void;
}) {
  const today = todayIndex();
  const kids = chart.stars
    .map((s) => ({ person: people.find((p) => p.id === s.personId), stars: s.stars }))
    .filter((k): k is { person: Person; stars: number } => !!k.person)
    .filter((k) => chart.chores.some((c) => c.personId === k.person.id));

  if (kids.length === 0)
    return (
      <div className="card chores-empty">
        <h2 className="h2">No chores yet</h2>
        <p>Add chores for the kids from a phone at /add, then they tick them off here.</p>
      </div>
    );

  return (
    <div className="chart">
      {kids.map(({ person, stars }) => {
        const mine = chart.chores.filter((c) => c.personId === person.id);
        const dailyLeft = mine.filter((c) => c.cadence === 'daily' && !isComplete(c)).length;
        return (
          <section key={person.id} className="card kid" aria-label={`${person.name}'s chores`}>
            <header className="kh">
              <Avatar person={person} size="lg" />
              <div className="kn">
                <h2 className="h2">{person.name}</h2>
                <span>{dailyLeft ? `${dailyLeft} to do today` : 'All done today'}</span>
              </div>
              <div className="tally" aria-label={`${stars} stars this week`}>
                <Star key={stars} className="bump" />
                <b className="tnum">{stars}</b>
                <small>this week</small>
              </div>
            </header>
            <div className="crow days" aria-hidden>
              <span />
              {DAYS.map((d, i) => (
                <span key={i} className={i === today ? 'today' : undefined}>
                  {d}
                </span>
              ))}
            </div>
            <ul className="crows">
              {mine.map((c) => (
                <li key={c.id}>
                  <ChoreRow chore={c} today={today} onTap={() => onTap(c)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ChoreRow({ chore, today, onTap }: { chore: Chore; today: number; onTap: () => void }) {
  const done = isComplete(chore);
  const week = chore.week ?? Array<number>(7).fill(0);
  const progress = chore.target > 1 ? ` ${chore.doneCount} of ${chore.target}` : '';
  const label =
    chore.cadence === 'daily'
      ? `${chore.title}, ${done ? 'done today' : `not done today${progress}`}`
      : `${chore.title}, ${done ? 'done this week' : `not done this week${progress}`}`;

  return (
    <button
      className={`crow chore${done ? ' done' : ''}`}
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onTap}
    >
      <span className="ct">
        {chore.title}
        <small>
          {chore.cadence === 'weekly'
            ? 'Once a week'
            : chore.target > 1
              ? `${chore.target}× a day`
              : ''}
          {chore.stars > 1
            ? `${chore.cadence === 'weekly' || chore.target > 1 ? ' · ' : ''}${chore.stars} stars`
            : ''}
        </small>
      </span>
      {chore.cadence === 'daily' ? (
        week.map((n, i) => (
          <span
            key={i}
            className={`cell${i === today ? ' today' : ''}${i > today ? ' future' : ''}`}
            title={DAY_NAMES[i]}
          >
            {n >= chore.target ? (
              <Star className={i === today ? 'pop' : ''} />
            ) : n > 0 ? (
              <span className="part tnum">
                {n}/{chore.target}
              </span>
            ) : (
              <i />
            )}
          </span>
        ))
      ) : (
        <span className="cell week">
          {Array.from({ length: chore.target }, (_, k) => (
            <Star
              key={k}
              filled={k < chore.doneCount}
              className={k < chore.doneCount ? 'pop' : ''}
            />
          ))}
          <span className="wl">{done ? 'Done this week' : 'Any day this week'}</span>
        </span>
      )}
    </button>
  );
}
