import type { List, ListItem, Person } from '@mantel/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Avatar } from './Avatar';

export function ListCard({
  list,
  people,
  onToggle,
  onAdd,
  onHome,
  handle,
}: {
  list: List;
  people: Person[];
  onToggle: (item: ListItem) => void;
  onAdd: (text: string) => void;
  /** Show this list on Today, or stop. Without it the card has no Today button. */
  onHome?: (home: boolean) => void;
  /** The drag handle, when the lists can be reordered. */
  handle?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const left = list.items.filter((i) => !i.done).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <section className="card lcard" aria-label={list.name}>
      <div className="lh">
        {handle}
        <h2 className="h2">{list.name}</h2>
        <span className="n tnum">{left ? `${left} left` : 'All done'}</span>
        {onHome && (
          <button
            type="button"
            className={`lhome${list.home ? ' on' : ''}`}
            aria-pressed={!!list.home}
            aria-label={list.home ? `${list.name} is on Today` : `Show ${list.name} on Today`}
            title={list.home ? 'On the Today screen' : 'Show on the Today screen'}
            onClick={() => onHome(!list.home)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4h6l-1 6 3.5 3.5H6.5L10 10zM12 13.5V20" />
            </svg>
          </button>
        )}
      </div>
      <ul className="litems">
        {list.items.map((item) => {
          const who = people.find((p) => p.id === item.personId);
          return (
            <li key={item.id}>
              <button
                className={`litem${item.done ? ' done' : ''}`}
                role="checkbox"
                aria-checked={item.done}
                onClick={() => onToggle(item)}
              >
                <span className="cb">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <span className="tx">{item.text}</span>
                {who && <Avatar person={who} size="sm" />}
              </button>
            </li>
          );
        })}
        {list.items.length === 0 && <li className="lempty">Nothing here yet.</li>}
      </ul>
      <form className="laddrow" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${list.name.toLowerCase()}`}
          aria-label={`Add to ${list.name}`}
          enterKeyHint="done"
        />
        <button type="submit" aria-label="Add" disabled={!draft.trim()}>
          +
        </button>
      </form>
    </section>
  );
}
