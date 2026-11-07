/**
 * This week's meals, read-only, from the Meals calendar (the meal planner's own routes take over
 * when workstream M lands). Each meal can push its name onto the grocery list.
 */
import { addDays, startOfDay, toIsoDate, type Meal } from '@mantel/shared';
import { useState } from 'react';
import { useNow } from '../../../app/Clock';
import { groceryList } from '../../lists/GroceryPeek';
import { useLists } from '../../lists/data';
import { slotWord, useMealPlan } from '../../today/Agenda';
import { relativeDay } from '../../today/calendar';
import { MagicImport } from '../MagicImport';

export function MealsTab() {
  const now = useNow(60_000);
  const today = startOfDay(now);
  const plan = useMealPlan(today);
  const { lists, add } = useLists();
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const grocery = lists ? groceryList(lists) : undefined;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const toGrocery = async (m: Meal) => {
    if (!grocery) return;
    const item = await add(grocery.id, m.title);
    setFlash(item ? `Added ${m.title} to ${grocery.name}` : `Couldn't add ${m.title}`);
    setTimeout(() => setFlash(null), 2000);
  };

  if (importing)
    return (
      <section className="card apanel">
        <MagicImport hint="meals" />
        <button type="button" className="alink neutral" onClick={() => setImporting(false)}>
          Back to meals
        </button>
      </section>
    );

  return (
    <>
      <header className="ahead arow">
        <h1 className="h1">Meals</h1>
        <button type="button" className="abtn small ghost" onClick={() => setImporting(true)}>
          Photo of a menu
        </button>
      </header>
      <div className="aflash" role="status">
        {flash}
      </div>
      {days.map((day) => {
        const meals = plan.get(toIsoDate(day)) ?? [];
        return (
          <section
            key={day.toISOString()}
            className="card apanel"
            aria-label={relativeDay(day, now)}
          >
            <h2 className="h2">{relativeDay(day, now)}</h2>
            {meals.length === 0 ? (
              <p className="amuted">Nothing planned.</p>
            ) : (
              <ul className="litems">
                {meals.map((m) => (
                  <li key={`${m.slot}-${m.title}`} className="aitem meal">
                    <span className="achore">
                      <span className="tx">
                        {m.title}
                        <small>{slotWord[m.slot]}</small>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="alink neutral"
                      disabled={!grocery}
                      onClick={() => void toGrocery(m)}
                    >
                      + Grocery
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p className="amuted small">
        Meals come from the calendar named Meals. Plan them from a phone by adding an event like
        "Dinner: Tacos" to that calendar, or snap a photo of a menu.
      </p>
    </>
  );
}
