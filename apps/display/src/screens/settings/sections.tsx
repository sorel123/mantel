import {
  DEFAULT_RELOAD_AT,
  type Calendar,
  type Destination,
  type FeatureFlags,
  type Person,
  type ScreenSchedule,
} from '@mantel/shared';
import {
  Chips,
  Field,
  NumberInput,
  RemoveButton,
  Section,
  TextInput,
  TimeInput,
  Toggle,
  newId,
} from './controls';

export function Schedule({
  value: s,
  onChange,
}: {
  value: ScreenSchedule;
  onChange: (v: ScreenSchedule) => void;
}) {
  const steps = s.brightness;
  const setStep = (i: number, step: ScreenSchedule['brightness'][number]) =>
    onChange({ ...s, brightness: steps.map((x, j) => (j === i ? step : x)) });
  return (
    <Section
      id="schedule"
      title="Screen schedule"
      hint="When the wall goes quiet, sleeps and wakes. Times are on the home timezone."
    >
      <Field label="Ambient after" hint="Seconds without a touch before photos take over.">
        <NumberInput
          label="Idle seconds"
          value={s.idleSeconds}
          min={5}
          step={5}
          onChange={(idleSeconds) => onChange({ ...s, idleSeconds })}
        />
      </Field>
      <Field label="Evening ambient from" hint="From this time the display rests on photos.">
        <TimeInput
          label="Evening ambient from"
          value={s.ambientFrom}
          onChange={(ambientFrom) => onChange({ ...s, ambientFrom })}
        />
      </Field>
      <Field label="Screen off" hint="Black overnight. Set both times the same to never turn off.">
        <span className="set-pair">
          <TimeInput
            label="Screen off from"
            value={s.offFrom}
            onChange={(offFrom) => onChange({ ...s, offFrom })}
          />
          <span className="set-hint">until</span>
          <TimeInput
            label="Screen on at"
            value={s.onAt}
            onChange={(onAt) => onChange({ ...s, onAt })}
          />
        </span>
      </Field>
      <Field label="Nightly reload" hint="Displays reload to pick up updates.">
        <TimeInput
          label="Nightly reload"
          value={s.reloadAt ?? DEFAULT_RELOAD_AT}
          onChange={(reloadAt) => onChange({ ...s, reloadAt })}
        />
      </Field>
      <div className="set-sub">
        <div className="set-label">
          Brightness through the day
          <span className="set-hint">Each step holds until the next one.</span>
        </div>
        {steps.map((step, i) => (
          <div className="set-row" key={i}>
            <TimeInput
              label={`Step ${i + 1} time`}
              value={step.at}
              onChange={(at) => setStep(i, { ...step, at })}
            />
            <input
              className="set-range"
              type="range"
              min={5}
              max={100}
              step={5}
              aria-label={`Step ${i + 1} brightness`}
              value={step.level}
              style={{ '--v': `${step.level}%` } as React.CSSProperties}
              onChange={(e) => setStep(i, { ...step, level: e.target.valueAsNumber })}
            />
            <span className="set-num tnum">{step.level}%</span>
            <RemoveButton
              label={`Remove step ${i + 1}`}
              onClick={() => onChange({ ...s, brightness: steps.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <button
          type="button"
          className="set-btn"
          onClick={() => onChange({ ...s, brightness: [...steps, { at: '12:00', level: 100 }] })}
        >
          Add a step
        </button>
      </div>
    </Section>
  );
}

const PALETTE = ['#e2694f', '#3f7bd9', '#8e63cf', '#3ba06f', '#d8a23a', '#d0568f', '#2f9aa6'];

export function People({
  value,
  calendars,
  onChange,
}: {
  value: Person[];
  calendars: Calendar[];
  onChange: (v: Person[]) => void;
}) {
  const update = (i: number, p: Person) => onChange(value.map((x, j) => (j === i ? p : x)));
  return (
    <Section
      id="people"
      title="People"
      hint="Each person gets a colour on the calendar. Events on their calendars carry it."
      action={
        <button
          type="button"
          className="set-btn"
          onClick={() =>
            onChange([
              ...value,
              {
                id: newId('person'),
                name: '',
                initial: '',
                color: PALETTE[value.length % PALETTE.length]!,
                calendarIds: [],
              },
            ])
          }
        >
          Add a person
        </button>
      }
    >
      {value.map((p, i) => (
        <div className="set-item" key={p.id}>
          <div className="set-row">
            <input
              className="set-color"
              type="color"
              aria-label={`${p.name || 'Person'} colour`}
              value={p.color}
              onChange={(e) => update(i, { ...p, color: e.target.value })}
            />
            <TextInput
              label="Name"
              placeholder="Name"
              value={p.name}
              onChange={(name) => {
                // Keep the initial in step with the name until someone sets it by hand.
                const auto = !p.initial || p.initial === p.name.slice(0, 1).toUpperCase();
                update(i, {
                  ...p,
                  name,
                  initial: auto ? name.slice(0, 1).toUpperCase() : p.initial,
                });
              }}
            />
            <TextInput
              label="Initial"
              placeholder="A"
              maxLength={2}
              value={p.initial}
              onChange={(initial) => update(i, { ...p, initial })}
            />
            <RemoveButton
              label={`Remove ${p.name || 'person'}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            />
          </div>
          <Chips
            label={`${p.name || 'Person'} calendars`}
            options={calendars.map((c) => ({ value: c.id, text: c.name, color: c.color }))}
            selected={p.calendarIds}
            onChange={(calendarIds) => update(i, { ...p, calendarIds })}
          />
        </div>
      ))}
    </Section>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Destinations({
  value,
  people,
  onChange,
}: {
  value: Destination[];
  people: Person[];
  onChange: (v: Destination[]) => void;
}) {
  const update = (i: number, d: Destination) => onChange(value.map((x, j) => (j === i ? d : x)));
  return (
    <Section
      id="places"
      title="Leave-by places"
      hint="School and work. On the chosen mornings the wall shows when to leave."
      action={
        <button
          type="button"
          className="set-btn"
          onClick={() =>
            onChange([
              ...value,
              {
                id: newId('dest'),
                name: '',
                address: '',
                personIds: [],
                arriveBy: '08:00',
                days: [1, 2, 3, 4, 5],
              },
            ])
          }
        >
          Add a place
        </button>
      }
    >
      {value.map((d, i) => (
        <div className="set-item" key={d.id}>
          <div className="set-row">
            <TextInput
              label="Place name"
              placeholder="Name"
              value={d.name}
              onChange={(name) => update(i, { ...d, name })}
            />
            <TextInput
              label="Address"
              placeholder="Address"
              value={d.address}
              onChange={(address) => update(i, { ...d, address })}
            />
            <RemoveButton
              label={`Remove ${d.name || 'place'}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            />
          </div>
          <div className="set-row">
            <span className="set-hint">Arrive by</span>
            <TimeInput
              label={`${d.name || 'Place'} arrive by`}
              value={d.arriveBy}
              onChange={(arriveBy) => update(i, { ...d, arriveBy })}
            />
            <Chips
              label={`${d.name || 'Place'} days`}
              options={DAYS.map((text, value) => ({ value, text }))}
              selected={d.days}
              onChange={(days) => update(i, { ...d, days: [...days].sort() })}
            />
          </div>
          <Chips
            label={`${d.name || 'Place'} people`}
            options={people.map((p) => ({ value: p.id, text: p.name || p.id, color: p.color }))}
            selected={d.personIds}
            onChange={(personIds) => update(i, { ...d, personIds })}
          />
        </div>
      ))}
    </Section>
  );
}

/** Labels for known flags; a flag added later still shows, under its key. */
const FLAG_LABELS: Partial<Record<keyof FeatureFlags, [string, string?]>> = {
  countdowns: ['Countdowns', 'Chips for events tagged with a star or #countdown'],
  meals: ['Meal plan', 'From the calendar named Meals'],
  commute: ['Leave-by times', 'Drive times on weekday mornings'],
  chores: ['Chore chart', 'Stars for the kids, reset weekly'],
  media: ['Now playing', 'Apple TV controls on the Home screen'],
  doorbellPopover: ['Doorbell pop-over', 'Live view over any screen when someone rings'],
  remindersSync: ['Apple Reminders sync', 'Not available yet: lists live on the server for now'],
  alexaAnnouncements: [
    'Alexa announcements',
    'Unofficial; needs Alexa Media Player in Home Assistant',
  ],
};

export function Features({
  value,
  onChange,
}: {
  value: FeatureFlags;
  onChange: (v: FeatureFlags) => void;
}) {
  return (
    <Section id="features" title="Features" hint="Turn parts of the display on or off.">
      {(Object.keys(value) as Array<keyof FeatureFlags>).map((k) => (
        <Toggle
          key={k}
          label={FLAG_LABELS[k]?.[0] ?? k}
          hint={FLAG_LABELS[k]?.[1]}
          checked={value[k]}
          onChange={(v) => onChange({ ...value, [k]: v })}
        />
      ))}
    </Section>
  );
}
