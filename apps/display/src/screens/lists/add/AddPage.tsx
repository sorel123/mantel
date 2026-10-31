import type { ChoreCadence, Person } from '@mantel/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Pairing } from '../../../app/Pairing';
import { useBootstrap, useBootstrapState } from '../../../lib/bootstrap';
import { connectEvents } from '../../../lib/events';
import { useThemeMode } from '../../../lib/theme';
import { Avatar } from '../Avatar';
import { groceryList } from '../GroceryPeek';
import { useChores, useLists } from '../data';
import '../lists.css';
import './add.css';

/**
 * The phone page at `/add`: add to any list in a couple of taps, tick or remove items, and
 * set up the kids' chores. A phone pairs once with the code from the server log, like a display.
 */
export function AddPage() {
  const { state, reload } = useBootstrapState();
  useThemeMode(state.status === 'ready' ? state.data.theme : 'auto');
  useEffect(() => {
    document.body.classList.add('phone');
    return () => document.body.classList.remove('phone');
  }, []);

  if (state.status === 'ready') return <Ready />;
  return (
    <main className="addpage">
      {state.status === 'unpaired' ? (
        <Pairing onPaired={reload} />
      ) : state.status === 'error' ? (
        <div className="card apanel">
          <h1 className="h2">Can't reach Mantel</h1>
          <p className="amuted">{state.message}</p>
          <button className="abtn" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <div className="amuted">Loading</div>
      )}
    </main>
  );
}

function Ready() {
  const boot = useBootstrap();
  useEffect(connectEvents, []);
  return (
    <main className="addpage">
      <AddItems people={boot.people} />
      {boot.flags.chores && <ManageChores people={boot.people} />}
    </main>
  );
}

function PersonChips({
  people,
  value,
  onChange,
  allowNone = true,
}: {
  people: Person[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="achips" role="radiogroup" aria-label="Who">
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          className="achip"
          onClick={() => onChange(undefined)}
        >
          Anyone
        </button>
      )}
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          className="achip"
          onClick={() => onChange(p.id)}
        >
          <Avatar person={p} size="sm" />
          {p.name}
        </button>
      ))}
    </div>
  );
}

function AddItems({ people }: { people: Person[] }) {
  const { lists, error, toggle, add, remove, createList, deleteList } = useLists();
  const [listId, setListId] = useState<string>();
  const [text, setText] = useState('');
  const [personId, setPersonId] = useState<string>();
  const [newList, setNewList] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const list = lists?.find((l) => l.id === listId) ?? (lists && groceryList(lists));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || !list) return;
    setText('');
    const item = await add(list.id, value, personId);
    setFlash(item ? `Added ${value}` : `Couldn't add ${value}`);
    setTimeout(() => setFlash(null), 2000);
  };

  const addList = async (e: FormEvent) => {
    e.preventDefault();
    if (!newList.trim()) return;
    const created = await createList(newList.trim());
    setNewList('');
    setListId(created.id);
  };

  if (!lists)
    return <div className="amuted">{error ? `Lists unavailable: ${error}` : 'Loading lists'}</div>;

  return (
    <>
      <header className="ahead">
        <div className="eyebrow">Mantel</div>
        <h1 className="h1">Add to a list</h1>
      </header>

      <div className="atabs" role="tablist" aria-label="Lists">
        {lists.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={l.id === list?.id}
            onClick={() => setListId(l.id)}
          >
            {l.name}
            <span className="tnum">{l.items.filter((i) => !i.done).length}</span>
          </button>
        ))}
      </div>

      {list && (
        <form className="card apanel" onSubmit={submit}>
          <input
            className="ainput"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Add to ${list.name.toLowerCase()}`}
            aria-label={`Add to ${list.name}`}
            enterKeyHint="send"
            autoFocus
          />
          <PersonChips people={people} value={personId} onChange={setPersonId} />
          <button className="abtn" type="submit" disabled={!text.trim()}>
            Add to {list.name}
          </button>
          <div className="aflash" role="status">
            {flash}
          </div>
        </form>
      )}

      {list && (
        <section className="card apanel">
          <div className="arow">
            <h2 className="h2">{list.name}</h2>
            <button
              className="alink"
              onClick={() => {
                if (window.confirm(`Delete the ${list.name} list and everything on it?`)) {
                  setListId(undefined);
                  void deleteList(list);
                }
              }}
            >
              Delete list
            </button>
          </div>
          <ul className="litems">
            {list.items.map((item) => {
              const who = people.find((p) => p.id === item.personId);
              return (
                <li key={item.id} className="aitem">
                  <button
                    className={`litem${item.done ? ' done' : ''}`}
                    role="checkbox"
                    aria-checked={item.done}
                    onClick={() => void toggle(item)}
                  >
                    <span className="cb">
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <span className="tx">{item.text}</span>
                    {who && <Avatar person={who} size="sm" />}
                  </button>
                  <button
                    className="ax"
                    aria-label={`Remove ${item.text}`}
                    onClick={() => void remove(item)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {list.items.length === 0 && <li className="lempty">Nothing here yet.</li>}
          </ul>
        </section>
      )}

      <form className="card apanel arow" onSubmit={addList}>
        <input
          className="ainput"
          value={newList}
          onChange={(e) => setNewList(e.target.value)}
          placeholder="New list"
          aria-label="New list name"
        />
        <button className="abtn small" type="submit" disabled={!newList.trim()}>
          Create
        </button>
      </form>
    </>
  );
}

function ManageChores({ people }: { people: Person[] }) {
  const { chart, create, retire } = useChores();
  const [title, setTitle] = useState('');
  const [personId, setPersonId] = useState<string | undefined>(people[people.length - 1]?.id);
  const [cadence, setCadence] = useState<ChoreCadence>('daily');
  const [stars, setStars] = useState(1);
  const [target, setTarget] = useState(1);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !personId) return;
    await create({ title: title.trim(), personId, cadence, stars, target });
    setTitle('');
  };

  return (
    <>
      <header className="ahead">
        <h1 className="h1">Chores</h1>
        <p className="amuted">Kids tick these off on the wall. Stars reset every Monday.</p>
      </header>

      <form className="card apanel" onSubmit={submit}>
        <input
          className="ainput"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New chore, like Make bed"
          aria-label="Chore name"
        />
        <PersonChips people={people} value={personId} onChange={setPersonId} allowNone={false} />
        <div className="achips" role="radiogroup" aria-label="How often">
          {(['daily', 'weekly'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cadence === c}
              className="achip"
              onClick={() => setCadence(c)}
            >
              {c === 'daily' ? 'Every day' : 'Once a week'}
            </button>
          ))}
        </div>
        <Stepper
          label="Times each"
          suffix={cadence === 'daily' ? 'day' : 'week'}
          value={target}
          min={1}
          max={7}
          onChange={setTarget}
        />
        <Stepper label="Stars each time" value={stars} min={1} max={5} onChange={setStars} />
        <button className="abtn" type="submit" disabled={!title.trim() || !personId}>
          Add chore
        </button>
      </form>

      {chart && chart.chores.length > 0 && (
        <section className="card apanel">
          <ul className="litems">
            {chart.chores.map((c) => {
              const who = people.find((p) => p.id === c.personId);
              return (
                <li key={c.id} className="aitem">
                  <span className="achore">
                    {who && <Avatar person={who} size="sm" />}
                    <span className="tx">
                      {c.title}
                      <small>
                        {c.cadence === 'daily' ? 'Every day' : 'Once a week'}
                        {c.target > 1 ? `, ${c.target} times` : ''} · {c.stars}★
                      </small>
                    </span>
                  </span>
                  <button
                    className="ax"
                    aria-label={`Remove ${c.title} for ${who?.name ?? c.personId}`}
                    onClick={() => void retire(c)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function Stepper({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="astep">
      <span>
        {label}
        {suffix ? ` ${suffix}` : ''}
      </span>
      <button
        type="button"
        aria-label={`Fewer: ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <b className="tnum" aria-live="polite">
        {value}
      </b>
      <button
        type="button"
        aria-label={`More: ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
