import {
  TIME_OF_DAY_LABEL,
  type Chore,
  type ChoreTimeOfDay,
  type Person,
  type Routine,
  type StarBalance,
} from '@mantel/shared';
import { Fragment } from 'react';
import { Avatar } from './Avatar';
import { useCelebrate } from './celebrate';
import { isComplete, todayIndex, type ChoreChart as Chart } from './data';
import { ChoreIconSvg } from './icons';

const ORDER: ChoreTimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];

/** A kid's chores in groups by part of the day, each named after its routine when it has one. */
function groups(mine: Chore[], routines: Routine[]) {
  return ORDER.map((t) => {
    const rows = mine.filter((c) => c.timeOfDay === t);
    const names = [
      ...new Set(
        rows
          .map((c) => routines.find((r) => r.id === c.routineId)?.name)
          .filter((n): n is string => !!n && n !== TIME_OF_DAY_LABEL[t]),
      ),
    ];
    const label = names.length
      ? `${TIME_OF_DAY_LABEL[t]} · ${names.join(', ')}`
      : TIME_OF_DAY_LABEL[t];
    return { t, label, rows };
  }).filter((g) => g.rows.length > 0);
}

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
  routines = [],
  balances = [],
  onRewards,
}: {
  chart: Chart;
  people: Person[];
  onTap: (chore: Chore) => void;
  routines?: Routine[];
  /** Banked stars, shown under the week's tally; tapping opens the Rewards drawer. */
  balances?: StarBalance[];
  onRewards?: (personId: string) => void;
}) {
  const today = todayIndex();
  const celebrate = useCelebrate();
  const kids = chart.stars
    .map((s) => ({ person: people.find((p) => p.id === s.personId), stars: s.stars }))
    .filter((k): k is { person: Person; stars: number } => !!k.person)
    .filter((k) => chart.chores.some((c) => c.personId === k.person.id));

  if (kids.length === 0)
    return (
      <div className="card chores-empty">
        <h2 className="h2">No chores yet</h2>
        <p>
          Add chores and routines in Settings under Chores and rewards, or from a phone at /add.
        </p>
      </div>
    );

  return (
    <div className="chart">
      {kids.map(({ person, stars }) => {
        const mine = chart.chores.filter((c) => c.personId === person.id);
        const dailyLeft = mine.filter((c) => c.cadence === 'daily' && !isComplete(c)).length;
        const banked = balances.find((b) => b.personId === person.id)?.stars;
        const grouped = groups(mine, routines);
        return (
          <section key={person.id} className="card kid" aria-label={`${person.name}'s chores`}>
            <header className="kh">
              <Avatar person={person} size="lg" />
              <div className="kn">
                <h2 className="h2">{person.name}</h2>
                <span>{dailyLeft ? `${dailyLeft} to do today` : 'All done today'}</span>
              </div>
              <button
                type="button"
                className="tally"
                aria-label={`${stars} stars this week${banked === undefined ? '' : `, ${banked} banked`}. Rewards`}
                onClick={() => onRewards?.(person.id)}
              >
                <Star key={stars} className="bump" />
                <b className="tnum">{stars}</b>
                <small>
                  this week
                  {banked !== undefined && (
                    <>
                      {' · '}
                      <span className="tnum">{banked}</span> banked
                    </>
                  )}
                </small>
              </button>
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
              {grouped.map((g) => (
                <Fragment key={g.t}>
                  {grouped.length > 1 && (
                    <li className="cgroup eyebrow" aria-hidden>
                      {g.label}
                    </li>
                  )}
                  {g.rows.map((c) => (
                    <li key={c.id}>
                      <ChoreRow
                        chore={c}
                        today={today}
                        onTap={(el) => {
                          if (!isComplete(c)) celebrate.burst(el, c.personId);
                          onTap(c);
                        }}
                      />
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ChoreRow({
  chore,
  today,
  onTap,
}: {
  chore: Chore;
  today: number;
  onTap: (star: Element | null) => void;
}) {
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
      onClick={(e) =>
        onTap(e.currentTarget.querySelector('.cell.today, .cell.week') ?? e.currentTarget)
      }
    >
      <span className="ct">
        <span className="ctt">
          <ChoreIconSvg icon={chore.icon} className="cti" />
          {chore.title}
        </span>
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
