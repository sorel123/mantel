/**
 * Recipes on the phone (the companion's Meals tab): a paste box, so a recipe found on the phone
 * is one paste away from the wall, the box as a list, and a recipe with a servings stepper,
 * "+ Grocery" and "Plan".
 */
import {
  addDays,
  fromIsoDate,
  minutesLabel,
  scaleFactor,
  scaleIngredientText,
  startOfDay,
  toIsoDate,
  type PlanSlot,
} from '@mantel/shared';
import { useState } from 'react';
import { useOverlay } from '../../../app/overlay';
import { dayNames } from '../../today/calendar';
import { SLOT_NAME } from '../data';
import { MealIcon, Svg } from '../icons';
import { AddRecipe } from './AddRecipe';
import {
  errorText,
  filterRecipes,
  groceryText,
  planRecipe,
  recipeToGrocery,
  siteOf,
  useRecipe,
  useRecipes,
} from './data';
import { RecipeIcon } from './icons';
import { useStrikes } from './RecipePage';
import { RecipePhoto } from './RecipesView';
import './recipes.css';

export function PhoneRecipes() {
  const [box] = useRecipes();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  if (open) return <PhoneRecipe id={open} onBack={() => setOpen(null)} />;
  const all = box.status === 'ready' ? box.data : [];
  const shown = filterRecipes(all, query, null);

  return (
    <div className="prc">
      <AddRecipe compact onDone={(id) => id && setOpen(id)} />
      {box.status === 'loading' && (
        <div className="prc-list" aria-label="Loading recipes">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton prc-skel" />
          ))}
        </div>
      )}
      {box.status === 'error' && <p className="amuted">{box.message}</p>}
      {box.status === 'ready' && all.length === 0 && (
        <p className="amuted">
          No recipes yet. Copy a link from any recipe site, then tap Paste above. It shows up on the
          wall too.
        </p>
      )}
      {all.length > 3 && (
        <input
          className="input"
          type="search"
          placeholder="Search recipes"
          aria-label="Search recipes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {all.length > 0 && (
        <ul className="prc-list" aria-label="Recipe box">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="card tap prc-row" onClick={() => setOpen(r.id)}>
                <RecipePhoto recipe={r} className="prc-thumb" />
                <span className="prc-text">
                  <b>{r.title}</b>
                  <small className="amuted">
                    {[
                      r.totalMinutes && minutesLabel(r.totalMinutes),
                      r.servings && `serves ${r.servings}`,
                      siteOf(r.sourceUrl),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhoneRecipe({ id, onBack }: { id: string; onBack: () => void }) {
  const [state] = useRecipe(id);
  const { toast } = useOverlay();
  const [servings, setServings] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const strikes = useStrikes(id);
  const today = startOfDay(new Date());
  const [date, setDate] = useState(toIsoDate(today));
  const [slot, setSlot] = useState<PlanSlot>('dinner');

  if (state.status !== 'ready')
    return (
      <div className="prc">
        <button type="button" className="alink neutral" onClick={onBack}>
          ‹ All recipes
        </button>
        {state.status === 'loading' ? (
          <div className="skeleton prc-skel tall" />
        ) : (
          <p className="amuted">{state.status === 'error' ? state.message : 'Turned off.'}</p>
        )}
      </div>
    );
  const r = state.data;
  const wanted = servings ?? r.servings;
  const factor = scaleFactor(r.servings, wanted ?? undefined);
  const days = Array.from({ length: 14 }, (_, i) => toIsoDate(addDays(today, i)));
  const say = async (work: () => Promise<string>) => {
    try {
      toast(await work());
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="prc prc-recipe" aria-label={r.title}>
      <button type="button" className="alink neutral" onClick={onBack}>
        ‹ All recipes
      </button>
      <RecipePhoto recipe={r} className="prc-hero" />
      <h2 className="h2">{r.title}</h2>
      <p className="amuted">
        {[r.totalMinutes && minutesLabel(r.totalMinutes), siteOf(r.sourceUrl)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="arow tight">
        <button
          type="button"
          className="abtn small"
          onClick={() =>
            void say(async () =>
              groceryText(
                await recipeToGrocery(r.id, factor !== 1 ? (wanted ?? undefined) : undefined),
              ),
            )
          }
        >
          + Grocery
        </button>
        <button type="button" className="abtn small ghost" onClick={() => setPlanning(!planning)}>
          Plan
        </button>
      </div>
      {planning && (
        <section className="card apanel" aria-label="Plan this recipe">
          <label className="prc-field">
            <span className="eyebrow">Day</span>
            <select className="input" value={date} onChange={(e) => setDate(e.target.value)}>
              {days.map((d, i) => (
                <option key={d} value={d}>
                  {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[fromIsoDate(d).getDay()]}{' '}
                  {fromIsoDate(d).getDate()}
                </option>
              ))}
            </select>
          </label>
          <label className="prc-field">
            <span className="eyebrow">Meal</span>
            <select
              className="input"
              value={slot}
              onChange={(e) => setSlot(e.target.value as PlanSlot)}
            >
              {(['breakfast', 'lunch', 'dinner'] as const).map((s) => (
                <option key={s} value={s}>
                  {SLOT_NAME[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="abtn"
            onClick={() =>
              void say(async () => {
                await planRecipe(date, slot, r.id);
                setPlanning(false);
                return `${r.title} for ${dayNames[fromIsoDate(date).getDay()]} ${slot}`;
              })
            }
          >
            Plan it
          </button>
        </section>
      )}
      <section className="card apanel" aria-label="Ingredients">
        <div className="arow">
          <h3 className="h3">Ingredients</h3>
          {r.servings && (
            <span className="prc-stepper">
              <button
                type="button"
                className="btn icon"
                aria-label="Fewer servings"
                disabled={(wanted ?? 1) <= 1}
                onClick={() => setServings(Math.max(1, (wanted ?? 1) - 1))}
              >
                <Svg>{RecipeIcon.minus}</Svg>
              </button>
              <b className="tnum">{wanted}</b>
              <button
                type="button"
                className="btn icon"
                aria-label="More servings"
                onClick={() => setServings(Math.min(100, (wanted ?? 1) + 1))}
              >
                <Svg>{MealIcon.plus}</Svg>
              </button>
            </span>
          )}
        </div>
        <ul className="rp-list">
          {r.ingredients.map((ing, i) => (
            <li key={i}>
              <button
                type="button"
                className={`rp-line${strikes.struck.has(`i${i}`) ? ' struck' : ''}`}
                onClick={() => strikes.toggle(`i${i}`)}
              >
                {scaleIngredientText(ing.text, factor)}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {r.steps.length > 0 && (
        <section className="card apanel" aria-label="Steps">
          <h3 className="h3">Steps</h3>
          <ol className="rp-list rp-steplist">
            {r.steps.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`rp-line rp-step${strikes.struck.has(`s${i}`) ? ' struck' : ''}`}
                  onClick={() => strikes.toggle(`s${i}`)}
                >
                  <span className="rp-num tnum">{i + 1}</span>
                  <span>{s}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
