import type { Chore, ChoreCadence, List, Person } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorText } from './client';
import { RemoveButton, Section, TextInput } from './controls';

/** Lists and chores from the settings page, so a household can set them up before the wall goes up. */
export function ListsSection({ people }: { people: Person[] }) {
  const [lists, setLists] = useState<List[] | null>(null);
  const [chores, setChores] = useState<Chore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newList, setNewList] = useState('');
  const [chore, setChore] = useState<{
    title: string;
    personId: string;
    cadence: ChoreCadence;
    stars: number;
    target: number;
  }>({
    title: '',
    personId: people[0]?.id ?? '',
    cadence: 'daily',
    stars: 1,
    target: 1,
  });

  const load = useCallback(() => {
    Promise.all([api.call('lists'), api.call('chores')])
      .then(([l, c]) => {
        setLists(l.lists);
        setChores(c.chores);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(load)
      .catch((err: unknown) => setError(errorText(err)));

  return (
    <Section
      id="lists"
      title="Lists and chores"
      hint="Lists live on the server; phones add to them at /add. Chores earn stars that reset every Monday."
    >
      {error && <p className="set-err">{error}</p>}
      <div className="set-sub wide">
        <div className="set-label">Lists</div>
        {lists?.map((l) => (
          <div className="set-row" key={l.id}>
            <span className="grow">
              {l.name}{' '}
              <span className="set-hint inline">{l.items.filter((i) => !i.done).length} open</span>
            </span>
            <RemoveButton
              label={`Delete list ${l.name}`}
              onClick={() => void act(() => api.call('listDelete', { params: { id: l.id } }))}
            />
          </div>
        ))}
        <form
          className="set-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newList.trim()) return;
            void act(() => api.call('listCreate', { body: { name: newList.trim() } }));
            setNewList('');
          }}
        >
          <TextInput
            label="New list name"
            placeholder="Hardware store"
            value={newList}
            onChange={setNewList}
          />
          <button type="submit" className="set-btn" disabled={!newList.trim()}>
            Add a list
          </button>
        </form>
      </div>
      <div className="set-sub wide">
        <div className="set-label">Chores</div>
        {chores?.map((c) => (
          <div className="set-row" key={c.id}>
            <span className="grow">
              {c.title}{' '}
              <span className="set-hint inline">
                {people.find((p) => p.id === c.personId)?.name ?? c.personId} · {c.cadence} ·{' '}
                {c.stars}★{c.target > 1 ? ` × ${c.target}` : ''}
              </span>
            </span>
            <RemoveButton
              label={`Retire chore ${c.title}`}
              onClick={() => void act(() => api.call('choreDelete', { params: { id: c.id } }))}
            />
          </div>
        ))}
        {chores && chores.length === 0 && <p className="set-hint">No chores yet.</p>}
        <form
          className="set-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chore.title.trim() || !chore.personId) return;
            void act(() =>
              api.call('choreCreate', { body: { ...chore, title: chore.title.trim() } }),
            );
            setChore((c) => ({ ...c, title: '' }));
          }}
        >
          <TextInput
            label="Chore"
            placeholder="Feed the dog"
            value={chore.title}
            onChange={(title) => setChore((c) => ({ ...c, title }))}
          />
          <select
            className="set-input"
            aria-label="Who"
            value={chore.personId}
            onChange={(e) => setChore((c) => ({ ...c, personId: e.target.value }))}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
          <select
            className="set-input"
            aria-label="How often"
            value={chore.cadence}
            onChange={(e) => setChore((c) => ({ ...c, cadence: e.target.value as ChoreCadence }))}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <select
            className="set-input"
            aria-label="Stars"
            value={chore.stars}
            onChange={(e) => setChore((c) => ({ ...c, stars: Number(e.target.value) }))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}★
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="set-btn"
            disabled={!chore.title.trim() || !chore.personId}
          >
            Add a chore
          </button>
        </form>
      </div>
    </Section>
  );
}
