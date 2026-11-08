import {
  DAY_PARTS,
  TIME_OF_DAY_LABEL,
  dayPartAt,
  type Chore,
  type DayPart,
  type Person,
  type Routine,
} from '@mantel/shared';
import { useState } from 'react';
import { dimClass, useDimmed } from '../today/personFilter';
import { Avatar } from './Avatar';
import { useCelebrate } from './celebrate';
import { Star } from './ChoreChart';
import { choresAt, isComplete } from './data';
import { ChoreIconSvg } from './icons';

/** What the routine card calls a finished part of the day: "the morning", or the routine's name. */
function finishedText(name: string, part: DayPart, routines: Routine[], rows: Chore[]) {
  const ids = new Set(rows.map((c) => c.routineId));
  const only = ids.size === 1 ? routines.find((r) => r.id === [...ids][0]) : undefined;
  return only
    ? `${name} finished the ${only.name.toLowerCase()} routine!`
    : `${name} finished everything for the ${part}!`;
}

/**
 * The routine for now, as a big checklist a child who can't read yet can follow: one column per
 * person, a row per step with a large icon and a short title. Morning until 11, afternoon until
 * 17:00, evening after; the chips switch to another part of the day.
 */
export function RoutineCard({
  chores,
  people,
  routines,
  onTap,
  now = new Date(),
}: {
  chores: Chore[];
  people: Person[];
  routines: Routine[];
  onTap: (chore: Chore) => void;
  now?: Date;
}) {
  const current = dayPartAt(now);
  const [part, setPart] = useState<DayPart>(current);
  const celebrate = useCelebrate();
  const dimmed = useDimmed();
  const who = people.filter((p) => choresAt(chores, p.id, part).length > 0);
  const partRoutines = routines.filter((r) => r.timeOfDay === part);
  const title =
    partRoutines.length === 1
      ? `${partRoutines[0]!.name} routine`
      : `${TIME_OF_DAY_LABEL[part]} routine`;

  const tap = (chore: Chore, row: HTMLElement, person: Person) => {
    const rows = choresAt(chores, person.id, part);
    if (!isComplete(chore)) {
      const willFinish = chore.doneCount + 1 >= chore.target;
      const restDone = rows.every((c) => c.id === chore.id || isComplete(c));
      if (willFinish && restDone)
        celebrate.banner(finishedText(person.name, part, routines, rows), person.id);
      else celebrate.burst(row.querySelector('.rcheck') ?? row, person.id);
    }
    onTap(chore);
  };

  return (
    <section className="card routine" aria-label={title}>
      <header className="rhead">
        <ChoreIconSvg
          icon={partRoutines[0]?.icon ?? (part === 'evening' ? 'moon' : 'sun')}
          className="rhead-icon"
        />
        <h2 className="h2">{title}</h2>
        <div className="rparts" role="group" aria-label="Part of the day">
          {DAY_PARTS.map((p) => (
            <button key={p} type="button" aria-pressed={p === part} onClick={() => setPart(p)}>
              {TIME_OF_DAY_LABEL[p]}
              {p === current && <span className="rnow">now</span>}
            </button>
          ))}
        </div>
      </header>
      {who.length === 0 ? (
        <p className="rnone">
          Nothing for the {part}. Add steps to a routine in Settings, under Chores and rewards.
        </p>
      ) : (
        <div className="rcols">
          {who.map((person) => {
            const rows = choresAt(chores, person.id, part);
            const left = rows.filter((c) => !isComplete(c)).length;
            return (
              <div
                className={`rcol${dimClass(dimmed([person.id]))}`}
                key={person.id}
                aria-label={`${person.name}'s ${part}`}
              >
                <div className="rwho">
                  <Avatar person={person} size="lg" />
                  <b>{person.name}</b>
                  <span className="tnum">{left === 0 ? 'All done' : `${left} to go`}</span>
                </div>
                <ul>
                  {rows.map((c) => {
                    const done = isComplete(c);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`rrow${done ? ' done' : ''}`}
                          role="checkbox"
                          aria-checked={done}
                          aria-label={`${c.title}${done ? ', done' : ''}`}
                          onClick={(e) => tap(c, e.currentTarget, person)}
                        >
                          <ChoreIconSvg icon={c.icon} className="ricon" />
                          <span className="rtitle">
                            {c.title}
                            {c.target > 1 && (
                              <small className="tnum">
                                {c.doneCount} of {c.target}
                              </small>
                            )}
                          </span>
                          <span className="rcheck">{done ? <Star className="pop" /> : <i />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
