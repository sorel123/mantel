/**
 * Settings, Meals (v3 M): the planner on or off, which slots it shows, which list ingredients go
 * to, and whether planned meals are written to the Meals calendar. Mounted by `../Optional.tsx`.
 */
import {
  DEFAULT_MEALS_SETTINGS,
  type Calendar,
  type List,
  type MealsSettings,
  type Settings,
} from '@mantel/shared';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Field, Section, Seg, Toggle } from '../controls';

type Slots = MealsSettings['slots'];
const SLOTS: Array<[Slots, string]> = [
  ['all', 'Breakfast, lunch and dinner'],
  ['dinner', 'Dinner only'],
];

export function MealsSection({
  draft,
  set,
  calendars,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  calendars: Calendar[];
}) {
  const value = draft.meals ?? DEFAULT_MEALS_SETTINGS;
  const on = draft.integrations.meals?.enabled !== false;
  const change = (patch: Partial<MealsSettings>) => set('meals', { ...value, ...patch });
  const [lists, setLists] = useState<List[] | null>(null);
  useEffect(() => {
    api
      .call('lists')
      .then((r) => setLists(r.lists))
      .catch(() => setLists([]));
  }, []);

  const mealsCal = calendars.find((c) => c.isMeals);
  const writable = mealsCal && !mealsCal.readOnly && mealsCal.source !== 'ical';
  const auto =
    lists?.find((l) => /grocer/i.test(l.name)) ??
    lists?.find((l) => /shopping/i.test(l.name)) ??
    lists?.[0];

  return (
    <Section
      id="meals"
      title="Meals"
      hint="Plan the week on the wall: tap Tonight or the meals card on Today. Pick from favourites or type a meal, and send its ingredients to the grocery list in one tap."
    >
      <Toggle
        label="Meal planner"
        hint="Off: Today shows meals from the Meals calendar only, and the planner does not open."
        checked={on}
        onChange={(enabled) => set('integrations', { ...draft.integrations, meals: { enabled } })}
      />
      <Field label="Slots" hint="Dinner only gives each day one big slot.">
        <Seg<Slots>
          label="Meal slots"
          value={value.slots}
          options={SLOTS}
          onChange={(slots) => change({ slots })}
        />
      </Field>
      <Field
        label="Grocery list"
        hint="Where “Add ingredients” puts them. Automatic picks the list named Grocery."
      >
        <select
          className="set-input"
          aria-label="Grocery list"
          value={value.groceryListId ?? ''}
          onChange={(e) => change({ groceryListId: e.target.value || null })}
        >
          <option value="">Automatic{auto ? ` (${auto.name})` : ''}</option>
          {(lists ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Toggle
        label="Write planned meals to the Meals calendar"
        hint={
          writable ? (
            <>
              Each planned meal becomes an all-day event on {mealsCal.name}, like “Dinner: Tacos”,
              so phones see the plan too.
            </>
          ) : mealsCal ? (
            <>{mealsCal.name} is read-only, so Mantel cannot write to it.</>
          ) : (
            <>
              No calendar is marked as the Meals calendar. Name one “Meals” or pick it in{' '}
              <a href="#calendars">Calendars</a>.
            </>
          )
        }
        checked={value.mirrorToCalendar}
        disabled={!writable && !value.mirrorToCalendar}
        onChange={(mirrorToCalendar) => change({ mirrorToCalendar })}
      />
      <p className="set-hint">
        A calendar named Meals is still read: its entries fill any slot the planner leaves empty,
        and a meal planned here wins over the calendar for that slot.
      </p>
    </Section>
  );
}
