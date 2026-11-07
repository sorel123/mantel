import {
  CHORE_ICONS,
  DEFAULT_CHORE_SETTINGS,
  TIME_OF_DAY_LABEL,
  type BodyOf,
  type Chore,
  type ChoreCadence,
  type ChoreSettings,
  type ChoreTimeOfDay,
  type Person,
  type Reward,
  type Routine,
  type Settings,
  type StarBalance,
  type StarLedgerEntry,
} from '@mantel/shared';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../../../lib/api';
import { ChoreIconSvg, iconLabel } from '../../lists/icons';
import { errorText } from '../client';
import { Chips, Field, RemoveButton, Result, Section, TextInput, Toggle } from '../controls';
import './chores.css';

const TIMES: ChoreTimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];

/** A button showing the icon; tapping it opens the grid of every bundled icon. */
export function IconPicker({
  value,
  onChange,
  label,
}: {
  value: string | undefined;
  onChange: (icon: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ch-icon">
      <button
        type="button"
        className="set-btn ch-icon-btn"
        aria-label={`${label}: ${value ? iconLabel(value) : 'none'}. Change`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChoreIconSvg icon={value} />
      </button>
      {open && (
        <span className="ch-icon-grid" role="listbox" aria-label={label}>
          {CHORE_ICONS.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={k === value}
              aria-label={iconLabel(k)}
              title={iconLabel(k)}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
            >
              <ChoreIconSvg icon={k} />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function TimeSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: ChoreTimeOfDay;
  onChange: (t: ChoreTimeOfDay) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="set-input"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ChoreTimeOfDay)}
    >
      {TIMES.map((t) => (
        <option key={t} value={t}>
          {TIME_OF_DAY_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

function PersonSelect({
  people,
  value,
  onChange,
  label = 'Who',
}: {
  people: Person[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <select
      className="set-input"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || p.id}
        </option>
      ))}
    </select>
  );
}

const name = (people: Person[], id: string) => people.find((p) => p.id === id)?.name || id;

interface Data {
  chores: Chore[];
  routines: Routine[];
  rewards: Reward[];
  balances: StarBalance[];
  ledger: StarLedgerEntry[];
}

/**
 * Settings › Chores and rewards: routines with their steps, every chore with its icon and time
 * of day, the rewards and their costs, star adjustments (with the admin PIN) and celebrations.
 * Chores, routines, rewards and stars save at once; the celebration switches save with the page.
 */
export function ChoresSection({
  draft,
  set,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const people = draft.people;
  const prefs: ChoreSettings = draft.chores ?? DEFAULT_CHORE_SETTINGS;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.call('chores'),
      api.call('routines'),
      api.call('rewards'),
      api.call('starsBalance'),
      api.call('starsLedger', { query: { limit: 12 } }),
    ])
      .then(([c, r, w, b, l]) =>
        setData({
          chores: c.chores,
          routines: r.routines,
          rewards: w.rewards,
          balances: b.balances,
          ledger: l.entries,
        }),
      )
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(() => {
        setError(null);
        load();
      })
      .catch((err: unknown) => setError(errorText(err)));

  return (
    <Section
      id="chores"
      title="Chores and rewards"
      hint="Routines show on the wall as a big checklist for the morning, afternoon or evening. Every chore earns stars that bank up; children spend them on rewards with a grown-up's PIN."
    >
      {error && <p className="set-err">{error}</p>}
      {!data ? (
        <p className="set-hint">Loading</p>
      ) : (
        <>
          <Routines people={people} data={data} act={act} />
          <Chores people={people} data={data} act={act} />
          <Rewards people={people} data={data} act={act} />
          <Stars people={people} data={data} act={act} />
        </>
      )}
      <div className="set-sub wide">
        <div className="set-label">Celebrations</div>
        <p className="set-hint">
          A burst of stars on every tick, a bigger one and a banner when someone finishes a routine.
          Changes here save with the Save button.
        </p>
        <Toggle
          label="Chime"
          hint="A short sound with each celebration. Off means silent."
          checked={prefs.chime}
          onChange={(chime) => set('chores', { ...prefs, chime })}
        />
        {people.map((p) => (
          <Toggle
            key={p.id}
            label={`Celebrations for ${p.name || p.id}`}
            checked={!prefs.celebrationsOff.includes(p.id)}
            onChange={(on) =>
              set('chores', {
                ...prefs,
                celebrationsOff: on
                  ? prefs.celebrationsOff.filter((x) => x !== p.id)
                  : [...prefs.celebrationsOff, p.id],
              })
            }
          />
        ))}
      </div>
    </Section>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function Routines({ people, data, act }: { people: Person[]; data: Data; act: Act }) {
  const [draft, setDraft] = useState<{
    name: string;
    timeOfDay: ChoreTimeOfDay;
    icon: string;
    personIds: string[];
  }>({ name: '', timeOfDay: 'morning', icon: 'sun', personIds: people.map((p) => p.id) });
  const [step, setStep] = useState<Record<string, { title: string; icon: string }>>({});

  return (
    <div className="set-sub wide">
      <div className="set-label">Routines</div>
      {data.routines.length === 0 && (
        <p className="set-hint">
          No routines yet. Try Morning (bed, teeth, backpack) and Bedtime (bath, pajamas, book).
        </p>
      )}
      {data.routines.map((r) => {
        const steps = data.chores.filter((c) => c.routineId === r.id);
        const s = step[r.id] ?? { title: '', icon: 'star' };
        const setS = (v: Partial<typeof s>) =>
          setStep((all) => ({ ...all, [r.id]: { ...s, ...v } }));
        return (
          <div className="ch-routine" key={r.id} aria-label={`${r.name} routine`} role="group">
            <div className="set-row">
              <IconPicker
                label={`${r.name} icon`}
                value={r.icon}
                onChange={(icon) =>
                  void act(() => api.call('routinePatch', { params: { id: r.id }, body: { icon } }))
                }
              />
              <b className="grow">{r.name}</b>
              <TimeSelect
                label={`${r.name} time of day`}
                value={r.timeOfDay}
                onChange={(timeOfDay) =>
                  void act(() =>
                    api.call('routinePatch', { params: { id: r.id }, body: { timeOfDay } }),
                  )
                }
              />
              <RemoveButton
                label={`Delete routine ${r.name}`}
                onClick={() => void act(() => api.call('routineDelete', { params: { id: r.id } }))}
              />
            </div>
            <Chips
              label={`Who does ${r.name}`}
              options={people.map((p) => ({ value: p.id, text: p.name || p.id, color: p.color }))}
              selected={r.personIds}
              onChange={(personIds) =>
                void act(() =>
                  api.call('routinePatch', { params: { id: r.id }, body: { personIds } }),
                )
              }
            />
            <ul className="ch-steps">
              {steps.map((c) => (
                <li key={c.id}>
                  <ChoreIconSvg icon={c.icon} />
                  <span className="grow">
                    {c.title} <span className="set-hint inline">{name(people, c.personId)}</span>
                  </span>
                  <RemoveButton
                    label={`Remove ${c.title} for ${name(people, c.personId)}`}
                    onClick={() =>
                      void act(() => api.call('choreDelete', { params: { id: c.id } }))
                    }
                  />
                </li>
              ))}
            </ul>
            <form
              className="set-row"
              onSubmit={(e) => {
                e.preventDefault();
                const title = s.title.trim();
                if (!title || r.personIds.length === 0) return;
                // One step per person in the routine, each with its own tick and stars.
                void act(() =>
                  Promise.all(
                    r.personIds.map((personId) =>
                      api.call('choreCreate', {
                        body: {
                          title,
                          personId,
                          cadence: 'daily',
                          icon: s.icon,
                          routineId: r.id,
                          timeOfDay: r.timeOfDay,
                        },
                      }),
                    ),
                  ),
                );
                setS({ title: '' });
              }}
            >
              <IconPicker
                label="New step icon"
                value={s.icon}
                onChange={(icon) => setS({ icon })}
              />
              <TextInput
                label={`New step for ${r.name}`}
                placeholder="Brush teeth"
                value={s.title}
                onChange={(title) => setS({ title })}
              />
              <button
                type="submit"
                className="set-btn"
                disabled={!s.title.trim() || r.personIds.length === 0}
              >
                Add a step
              </button>
            </form>
          </div>
        );
      })}
      <form
        className="set-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          void act(() =>
            api.call('routineCreate', { body: { ...draft, name: draft.name.trim() } }),
          );
          setDraft((d) => ({ ...d, name: '' }));
        }}
      >
        <IconPicker
          label="New routine icon"
          value={draft.icon}
          onChange={(icon) => setDraft((d) => ({ ...d, icon }))}
        />
        <TextInput
          label="New routine name"
          placeholder="Morning"
          value={draft.name}
          onChange={(n) => setDraft((d) => ({ ...d, name: n }))}
        />
        <TimeSelect
          label="New routine time of day"
          value={draft.timeOfDay}
          onChange={(timeOfDay) => setDraft((d) => ({ ...d, timeOfDay }))}
        />
        <button type="submit" className="set-btn" disabled={!draft.name.trim()}>
          Add a routine
        </button>
      </form>
    </div>
  );
}

function Chores({ people, data, act }: { people: Person[]; data: Data; act: Act }) {
  const [chore, setChore] = useState<{
    title: string;
    personId: string;
    cadence: ChoreCadence;
    stars: number;
    timeOfDay: ChoreTimeOfDay;
    icon: string;
  }>({
    title: '',
    personId: people[0]?.id ?? '',
    cadence: 'daily',
    stars: 1,
    timeOfDay: 'any',
    icon: 'star',
  });
  const patch = (c: Chore, body: BodyOf<'choreUpdate'>) =>
    void act(() => api.call('choreUpdate', { params: { id: c.id }, body }));

  return (
    <div className="set-sub wide">
      <div className="set-label">Chores</div>
      {data.chores.length === 0 && <p className="set-hint">No chores yet.</p>}
      {data.chores.map((c) => (
        <div className="set-row ch-chore" key={c.id}>
          <IconPicker
            label={`${c.title} icon`}
            value={c.icon}
            onChange={(icon) => patch(c, { icon })}
          />
          <span className="grow">
            {c.title}{' '}
            <span className="set-hint inline">
              {name(people, c.personId)} · {c.cadence === 'daily' ? 'daily' : 'weekly'} · {c.stars}★
              {c.target > 1 ? ` × ${c.target}` : ''}
            </span>
          </span>
          <TimeSelect
            label={`${c.title} for ${name(people, c.personId)}: time of day`}
            value={c.timeOfDay}
            disabled={!!c.routineId}
            onChange={(timeOfDay) => patch(c, { timeOfDay })}
          />
          <select
            className="set-input"
            aria-label={`${c.title} for ${name(people, c.personId)}: routine`}
            value={c.routineId ?? ''}
            onChange={(e) => patch(c, { routineId: e.target.value || null })}
          >
            <option value="">No routine</option>
            {data.routines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <RemoveButton
            label={`Retire chore ${c.title}`}
            onClick={() => void act(() => api.call('choreDelete', { params: { id: c.id } }))}
          />
        </div>
      ))}
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
        <IconPicker
          label="New chore icon"
          value={chore.icon}
          onChange={(icon) => setChore((c) => ({ ...c, icon }))}
        />
        <TextInput
          label="New chore"
          placeholder="Feed the dog"
          value={chore.title}
          onChange={(title) => setChore((c) => ({ ...c, title }))}
        />
        <PersonSelect
          people={people}
          value={chore.personId}
          onChange={(personId) => setChore((c) => ({ ...c, personId }))}
        />
        <TimeSelect
          label="New chore time of day"
          value={chore.timeOfDay}
          onChange={(timeOfDay) => setChore((c) => ({ ...c, timeOfDay }))}
        />
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
        <button type="submit" className="set-btn" disabled={!chore.title.trim()}>
          Add a chore
        </button>
      </form>
    </div>
  );
}

function Rewards({ people, data, act }: { people: Person[]; data: Data; act: Act }) {
  const [draft, setDraft] = useState({ title: '', cost: '10', icon: 'gift' });
  const cost = Number(draft.cost);
  const okCost = Number.isInteger(cost) && cost >= 1 && cost <= 1000;
  return (
    <div className="set-sub wide">
      <div className="set-label">Rewards</div>
      {data.rewards.length === 0 && (
        <p className="set-hint">
          No rewards yet. Ideas: pick the movie, a later bedtime, ice cream.
        </p>
      )}
      {data.rewards.map((r) => (
        <div className="ch-reward" key={r.id} role="group" aria-label={`Reward ${r.title}`}>
          <div className="set-row">
            <IconPicker
              label={`${r.title} icon`}
              value={r.icon}
              onChange={(icon) =>
                void act(() => api.call('rewardPatch', { params: { id: r.id }, body: { icon } }))
              }
            />
            <span className="grow">
              {r.title} <span className="set-hint inline">{r.cost}★</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={r.active}
              aria-label={`${r.title} on the wall`}
              className={`sw${r.active ? ' on' : ''}`}
              onClick={() =>
                void act(() =>
                  api.call('rewardPatch', { params: { id: r.id }, body: { active: !r.active } }),
                )
              }
            />
            <RemoveButton
              label={`Delete reward ${r.title}`}
              onClick={() => void act(() => api.call('rewardDelete', { params: { id: r.id } }))}
            />
          </div>
          <Chips
            label={`Who can pick ${r.title} (none means everyone)`}
            options={people.map((p) => ({ value: p.id, text: p.name || p.id, color: p.color }))}
            selected={r.personIds}
            onChange={(personIds) =>
              void act(() => api.call('rewardPatch', { params: { id: r.id }, body: { personIds } }))
            }
          />
        </div>
      ))}
      <form
        className="set-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.title.trim() || !okCost) return;
          void act(() =>
            api.call('rewardCreate', {
              body: { title: draft.title.trim(), cost, icon: draft.icon, personIds: [] },
            }),
          );
          setDraft((d) => ({ ...d, title: '' }));
        }}
      >
        <IconPicker
          label="New reward icon"
          value={draft.icon}
          onChange={(icon) => setDraft((d) => ({ ...d, icon }))}
        />
        <TextInput
          label="New reward"
          placeholder="Pick the movie"
          value={draft.title}
          onChange={(title) => setDraft((d) => ({ ...d, title }))}
        />
        <TextInput
          label="Cost in stars"
          inputMode="numeric"
          className="ch-cost"
          value={draft.cost}
          onChange={(v) => setDraft((d) => ({ ...d, cost: v.replace(/\D/g, '') }))}
        />
        <button type="submit" className="set-btn" disabled={!draft.title.trim() || !okCost}>
          Add a reward
        </button>
      </form>
    </div>
  );
}

function Stars({ people, data, act }: { people: Person[]; data: Data; act: Act }) {
  const [adj, setAdj] = useState({
    personId: people[0]?.id ?? '',
    delta: '5',
    note: '',
    pin: '',
  });
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const delta = Number(adj.delta);
  const ok = Number.isInteger(delta) && delta !== 0 && Math.abs(delta) <= 500;
  return (
    <div className="set-sub wide">
      <div className="set-label">Stars</div>
      <div className="ch-balances">
        {people.map((p) => (
          <span key={p.id} className="ch-balance" style={{ '--chip': p.color } as CSSProperties}>
            <i />
            {p.name || p.id}{' '}
            <b className="tnum">{data.balances.find((b) => b.personId === p.id)?.stars ?? 0}★</b>
          </span>
        ))}
      </div>
      <form
        className="set-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok || !adj.personId) return;
          setResult(null);
          void act(async () => {
            try {
              await api.call('starsAdjust', {
                body: {
                  personId: adj.personId,
                  delta,
                  reason: delta > 0 ? 'bonus' : 'adjust',
                  pin: adj.pin,
                  ...(adj.note.trim() ? { note: adj.note.trim() } : {}),
                },
              });
              setResult({
                ok: true,
                message: `${delta > 0 ? 'Added' : 'Took away'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'star' : 'stars'} for ${name(people, adj.personId)}.`,
              });
              setAdj((a) => ({ ...a, note: '', pin: '' }));
            } catch (err) {
              setResult({ ok: false, message: errorText(err) });
            }
          });
        }}
      >
        <PersonSelect
          people={people}
          label="Whose stars"
          value={adj.personId}
          onChange={(personId) => setAdj((a) => ({ ...a, personId }))}
        />
        <TextInput
          label="Stars to add (minus to take away)"
          className="ch-cost"
          inputMode="numeric"
          value={adj.delta}
          onChange={(v) => setAdj((a) => ({ ...a, delta: v.replace(/[^\d-]/g, '') }))}
        />
        <TextInput
          label="Reason"
          placeholder="Helped with the groceries"
          maxLength={120}
          value={adj.note}
          onChange={(note) => setAdj((a) => ({ ...a, note }))}
        />
        <TextInput
          label="Admin PIN"
          type="password"
          inputMode="numeric"
          className="ch-cost"
          placeholder="PIN"
          value={adj.pin}
          onChange={(pin) => setAdj((a) => ({ ...a, pin: pin.replace(/\D/g, '') }))}
        />
        <button type="submit" className="set-btn" disabled={!ok || adj.pin.length < 4}>
          {delta < 0 ? 'Take away' : 'Add stars'}
        </button>
      </form>
      <Result result={result} />
      {data.ledger.length > 0 && (
        <Field label="Lately" stack>
          <ul className="ch-ledger">
            {data.ledger.map((e) => (
              <li key={e.id}>
                <span>
                  {name(people, e.personId)}: {e.note ?? e.reason}
                </span>
                <b className="tnum">{e.delta > 0 ? `+${e.delta}` : e.delta}</b>
              </li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}
