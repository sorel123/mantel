/**
 * Chores from the phone: pick a person, tick their chores for today, see this week's stars.
 * Setting chores up lives under "Set up chores" (the same form the old /add page had).
 */
import type { Chore, Person } from '@mantel/shared';
import { useState } from 'react';
import { Avatar } from '../../lists/Avatar';
import { Star } from '../../lists/ChoreChart';
import { isComplete, useChores } from '../../lists/data';
import { ManageChores, PersonChips } from '../ListsTab';

export function ChoresTab({ people }: { people: Person[] }) {
  const { chart, error, tap } = useChores();
  const withChores = people.filter((p) => chart?.chores.some((c) => c.personId === p.id));
  const [who, setWho] = useState<string | undefined>();
  const [manage, setManage] = useState(false);
  const person = withChores.find((p) => p.id === who) ?? withChores[0];

  if (!chart)
    return (
      <div className="amuted">{error ? `Chores unavailable: ${error}` : 'Loading chores'}</div>
    );

  const mine = person ? chart.chores.filter((c) => c.personId === person.id) : [];
  const stars = chart.stars.find((s) => s.personId === person?.id)?.stars ?? 0;
  const left = mine.filter((c) => !isComplete(c)).length;

  return (
    <>
      <header className="ahead arow">
        <h1 className="h1">Chores</h1>
        <button type="button" className="alink neutral" onClick={() => setManage((m) => !m)}>
          {manage ? 'Done' : 'Set up'}
        </button>
      </header>

      {manage ? (
        <ManageChores people={people} />
      ) : withChores.length === 0 ? (
        <section className="card apanel">
          <h2 className="h2">No chores yet</h2>
          <p className="amuted">Press Set up to add the first one.</p>
        </section>
      ) : (
        <>
          <PersonChips
            people={withChores}
            value={person?.id}
            onChange={(id) => setWho(id)}
            allowNone={false}
          />
          {person && (
            <section className="card apanel" aria-label={`${person.name}'s chores`}>
              <div className="arow">
                <div className="arow tight">
                  <Avatar person={person} size="lg" />
                  <div>
                    <h2 className="h2">{person.name}</h2>
                    <span className="amuted">{left ? `${left} to do` : 'All done'}</span>
                  </div>
                </div>
                <div className="ctally" aria-label={`${stars} stars this week`}>
                  <Star />
                  <b className="tnum">{stars}</b>
                  <small>this week</small>
                </div>
              </div>
              <ul className="litems">
                {mine.map((c) => (
                  <ChoreTick key={c.id} chore={c} onTap={() => void tap(c)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function ChoreTick({ chore, onTap }: { chore: Chore; onTap: () => void }) {
  const done = isComplete(chore);
  return (
    <li className="aitem">
      <button
        type="button"
        className={`litem${done ? ' done' : ''}`}
        role="checkbox"
        aria-checked={done}
        onClick={onTap}
      >
        <span className="cb">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <span className="tx">
          {chore.title}
          {chore.target > 1 && (
            <small className="amuted">
              {' '}
              {Math.min(chore.doneCount, chore.target)}/{chore.target}
            </small>
          )}
        </span>
        <span className="cstars tnum" aria-label={`${chore.stars} stars`}>
          {chore.stars}
          <Star />
        </span>
      </button>
    </li>
  );
}
