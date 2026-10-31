import { useState } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { ChoreChart, Star } from './ChoreChart';
import { useChores, useLists } from './data';
import { ListCard } from './ListCard';
import './lists.css';

export { GroceryPeek } from './GroceryPeek';

type Tab = 'lists' | 'chores';

/** Lists side by side with a check animation and an add row, and the kids' chore chart. */
export function ListsScreen() {
  const boot = useBootstrap();
  const [tab, setTab] = useState<Tab>('lists');
  const { lists, error, toggle, add } = useLists();
  const { chart, tap } = useChores();
  const showChores = boot.flags.chores;
  const stars = chart?.stars.reduce((n, s) => n + s.stars, 0) ?? 0;

  return (
    <div className="lists-screen">
      {showChores && (
        <div className="ltabs" role="tablist" aria-label="Lists or chores">
          <button role="tab" aria-selected={tab === 'lists'} onClick={() => setTab('lists')}>
            Lists
          </button>
          <button role="tab" aria-selected={tab === 'chores'} onClick={() => setTab('chores')}>
            Chore chart
            {chart && (
              <span className="tstars tnum">
                <Star />
                {stars}
              </span>
            )}
          </button>
        </div>
      )}
      {tab === 'lists' || !showChores ? (
        lists ? (
          <div className="lgrid">
            {lists.map((l) => (
              <ListCard
                key={l.id}
                list={l}
                people={boot.people}
                onToggle={toggle}
                onAdd={(text) => void add(l.id, text)}
              />
            ))}
          </div>
        ) : (
          <div className="lstate">{error ? `Lists unavailable: ${error}` : 'Loading lists'}</div>
        )
      ) : chart ? (
        <ChoreChart chart={chart} people={boot.people} onTap={(c) => void tap(c)} />
      ) : (
        <div className="lstate">Loading chores</div>
      )}
    </div>
  );
}
