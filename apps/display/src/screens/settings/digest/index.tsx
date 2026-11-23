/**
 * Settings, Digest and reminders (v4 D): per person, when the morning digest and the evening
 * preview go and what they hold; the household's quiet hours and reminders; and a button that
 * sends a test digest and shows it here. Mounted by `../Optional.tsx`.
 */
import {
  DEFAULT_DIGEST_SETTINGS,
  DIGEST_INCLUDE_LABELS,
  digestPerson,
  type Calendar,
  type Digest,
  type DigestInclude,
  type DigestKind,
  type DigestPerson,
  type DigestSettings,
  type DigestStatusResponse,
  type Settings,
} from '@mantel/shared';
import { useEffect, useState } from 'react';
import { DigestView, clockOf } from '../../../features/digest';
import { api } from '../../../lib/api';
import { Avatar } from '../../lists/Avatar';
import { errorText } from '../client';
import { Chips, Collapse, Field, Result, Section, Seg, TimeInput, Toggle } from '../controls';
import './digest.css';

const REMINDER_OPTIONS: Array<[string, string]> = [
  ['0', 'Off'],
  ['10', '10 min'],
  ['15', '15 min'],
  ['30', '30 min'],
  ['60', '1 hour'],
];
const INCLUDE_KEYS = Object.keys(DIGEST_INCLUDE_LABELS) as Array<keyof DigestInclude>;

const whenText = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 864e5);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, today)
    ? 'today'
    : same(d, tomorrow)
      ? 'tomorrow'
      : d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${day} at ${clockOf(iso)}`;
};

export function DigestSection({
  draft,
  set,
  calendars = [],
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  calendars?: Calendar[];
}) {
  const value: DigestSettings = draft.digest ?? DEFAULT_DIGEST_SETTINGS;
  const change = (patch: Partial<DigestSettings>) => set('digest', { ...value, ...patch });
  const on = draft.integrations.digest?.enabled !== false;
  const [status, setStatus] = useState<DigestStatusResponse | null>(null);

  useEffect(() => {
    api
      .call('digestStatus')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [draft.digest, draft.people]);

  const person = (id: string) => digestPerson(value, id);
  const setPerson = (id: string, patch: Partial<DigestPerson>) => {
    const next = { ...person(id), ...patch };
    change({ people: [...value.people.filter((p) => p.personId !== id), next] });
  };

  return (
    <Section
      id="digest"
      title="Digest and reminders"
      hint="Each person gets their day on their phone at breakfast: events and when to leave, their chores, dinner, the weather and anything to remember. Phones choose whose they are under the bell in the phone app."
    >
      <Toggle
        label="Digest and reminders"
        hint="Off: no digest, no reminders and no “since you last looked”."
        checked={on}
        onChange={(enabled) => set('integrations', { ...draft.integrations, digest: { enabled } })}
      />

      {on && (
        <>
          <div className="dgs-people">
            {draft.people.length === 0 && (
              <p className="set-hint">
                Add people in Settings, People to give each their own digest.
              </p>
            )}
            {draft.people.map((p) => {
              const d = person(p.id);
              const st = status?.people.find((s) => s.personId === p.id);
              return (
                <article key={p.id} className="dgs-person" aria-label={`${p.name}'s digest`}>
                  <header className="dgs-person-head">
                    <Avatar person={p} size="lg" />
                    <div>
                      <h3 className="h3">{p.name}</h3>
                      <span className="set-hint">
                        {st
                          ? st.phones
                            ? `${st.phones} phone${st.phones === 1 ? '' : 's'}${
                                st.nextMorning ? ` · next ${whenText(st.nextMorning)}` : ''
                              }`
                            : `No phone yet: on ${p.name}'s phone open the app, tap the bell and choose ${p.name}.`
                          : ' '}
                      </span>
                    </div>
                  </header>
                  <Toggle
                    label="Morning digest"
                    checked={d.morning}
                    onChange={(morning) => setPerson(p.id, { morning })}
                  />
                  {d.morning && (
                    <div className="dgs-times">
                      <Field label="Weekdays">
                        <TimeInput
                          label={`${p.name}'s weekday digest time`}
                          value={d.weekdayTime}
                          onChange={(weekdayTime) => setPerson(p.id, { weekdayTime })}
                        />
                      </Field>
                      <Field label="Weekends">
                        <TimeInput
                          label={`${p.name}'s weekend digest time`}
                          value={d.weekendTime}
                          onChange={(weekendTime) => setPerson(p.id, { weekendTime })}
                        />
                      </Field>
                    </div>
                  )}
                  <Toggle
                    label="Evening preview of tomorrow"
                    checked={d.evening}
                    onChange={(evening) => setPerson(p.id, { evening })}
                  />
                  {d.evening && (
                    <Field label="Evening at">
                      <TimeInput
                        label={`${p.name}'s evening preview time`}
                        value={d.eveningTime}
                        onChange={(eveningTime) => setPerson(p.id, { eveningTime })}
                      />
                    </Field>
                  )}
                  <Toggle
                    label="Remind about open routine steps"
                    hint={`At ${clockOf(`T${value.nudges.routineTime}`)} when a routine is not finished.`}
                    checked={d.routineNudge}
                    onChange={(routineNudge) => setPerson(p.id, { routineNudge })}
                  />
                  <Field label="Include" stack>
                    <Chips<keyof DigestInclude>
                      label={`What ${p.name}'s digest includes`}
                      options={INCLUDE_KEYS.map((k) => ({
                        value: k,
                        text: DIGEST_INCLUDE_LABELS[k],
                      }))}
                      selected={INCLUDE_KEYS.filter((k) => d.include[k])}
                      onChange={(keys) =>
                        setPerson(p.id, {
                          include: Object.fromEntries(
                            INCLUDE_KEYS.map((k) => [k, keys.includes(k)]),
                          ) as DigestInclude,
                        })
                      }
                    />
                  </Field>
                </article>
              );
            })}
          </div>

          <h3 className="h3 dgs-sub">Reminders</h3>
          <Field label="Before each event" hint="To the phones of the people on the event.">
            <Seg
              label="Event reminder"
              value={String(value.nudges.eventMinutes)}
              options={REMINDER_OPTIONS}
              onChange={(v) => change({ nudges: { ...value.nudges, eventMinutes: Number(v) } })}
            />
          </Field>
          {calendars.length > 0 && (
            <Collapse title="Per calendar" hint="A school calendar might need none.">
              {calendars
                .filter((c) => !c.isMeals)
                .map((c) => (
                  <Field key={c.id} label={c.name}>
                    <select
                      className="set-input"
                      aria-label={`Reminders for ${c.name}`}
                      value={String(value.nudges.calendarMinutes[c.id] ?? 'default')}
                      onChange={(e) => {
                        const next = { ...value.nudges.calendarMinutes };
                        if (e.target.value === 'default') delete next[c.id];
                        else next[c.id] = Number(e.target.value);
                        change({ nudges: { ...value.nudges, calendarMinutes: next } });
                      }}
                    >
                      <option value="default">Same as above</option>
                      {REMINDER_OPTIONS.map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
            </Collapse>
          )}
          <Field label="Routine reminder at">
            <TimeInput
              label="Routine reminder time"
              value={value.nudges.routineTime}
              onChange={(routineTime) => change({ nudges: { ...value.nudges, routineTime } })}
            />
          </Field>
          <Toggle
            label="Say when dinner is not planned"
            checked={value.nudges.dinner}
            onChange={(dinner) => change({ nudges: { ...value.nudges, dinner } })}
          />
          {value.nudges.dinner && (
            <Field label="Check dinner at">
              <TimeInput
                label="Dinner check time"
                value={value.nudges.dinnerTime}
                onChange={(dinnerTime) => change({ nudges: { ...value.nudges, dinnerTime } })}
              />
            </Field>
          )}

          <h3 className="h3 dgs-sub">Quiet hours</h3>
          <Toggle
            label="Quiet hours"
            hint="Nothing from the digest or reminders arrives in these hours. A digest due then goes when they end."
            checked={value.quiet.enabled}
            onChange={(enabled) => change({ quiet: { ...value.quiet, enabled } })}
          />
          {value.quiet.enabled && (
            <div className="dgs-times">
              <Field label="From">
                <TimeInput
                  label="Quiet from"
                  value={value.quiet.from}
                  onChange={(from) => change({ quiet: { ...value.quiet, from } })}
                />
              </Field>
              <Field label="Until">
                <TimeInput
                  label="Quiet until"
                  value={value.quiet.to}
                  onChange={(to) => change({ quiet: { ...value.quiet, to } })}
                />
              </Field>
            </div>
          )}

          <h3 className="h3 dgs-sub">Extras</h3>
          <Toggle
            label="A friendly first line from Claude"
            hint={
              status && !status.aiReady
                ? 'Needs the Claude key from Settings, Weather quips.'
                : 'One sentence that sums up the day. Uses the Claude key from Weather quips.'
            }
            checked={value.aiSummary}
            disabled={!!status && !status.aiReady}
            onChange={(aiSummary) => change({ aiSummary })}
          />
          <Toggle
            label="“Since you last looked”"
            hint="On the wall's Today screen and at the top of the phone app: what changed, tap to jump to it."
            checked={value.sinceStrip}
            onChange={(sinceStrip) => change({ sinceStrip })}
          />

          <TestDigest draft={draft} />
        </>
      )}
    </Section>
  );
}

function TestDigest({ draft }: { draft: Settings }) {
  const [personId, setPersonId] = useState(draft.people[0]?.id ?? '');
  const [kind, setKind] = useState<DigestKind>('morning');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.call('digestTest', { body: { personId: personId || undefined, kind } });
      setResult({ ok: r.ok, message: r.message });
      setDigest(r.digest);
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!draft.people.length) return null;
  return (
    <div className="dgs-test">
      <h3 className="h3 dgs-sub">Try it</h3>
      <div className="dgs-test-row">
        <select
          className="set-input"
          aria-label="Whose digest"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          {draft.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Seg<DigestKind>
          label="Which digest"
          value={kind}
          options={[
            ['morning', 'Morning'],
            ['evening', 'Evening'],
          ]}
          onChange={setKind}
        />
        <button
          type="button"
          className="set-btn primary"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send me a test digest'}
        </button>
      </div>
      <p className="set-hint">Uses the saved settings. It also shows here, as the phone will.</p>
      <Result result={result} />
      {digest && (
        <div className="dgs-preview" data-testid="digest-preview">
          <DigestView digest={digest} people={draft.people} />
        </div>
      )}
    </div>
  );
}
