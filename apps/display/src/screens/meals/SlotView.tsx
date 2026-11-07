/**
 * One slot of the planner: what is planned (with "Add ingredients to Grocery" and Remove), and
 * the picker: favourites by search, tag and recent use, or a meal typed with its ingredients.
 */
import {
  parseIngredients,
  type Favourite,
  type MealsWeekResponse,
  type PlanSlot,
} from '@mantel/shared';
import { useState } from 'react';
import { useOverlay } from '../../app/overlay';
import {
  allTags,
  clearMeal,
  createFavourite,
  errorText,
  favouritesFor,
  groceryToast,
  mealAt,
  mealToGrocery,
  planMeal,
  recentFavourites,
  slotLabel,
} from './data';
import { MealIcon, Svg } from './icons';

export function SlotView({
  week,
  date,
  slot,
  favourites,
  onBack,
}: {
  week: MealsWeekResponse;
  date: string;
  slot: PlanSlot;
  favourites: Favourite[];
  onBack: () => void;
}) {
  const { toast } = useOverlay();
  const meal = mealAt(week, date, slot);
  const [picking, setPicking] = useState(!meal);
  const [busy, setBusy] = useState(false);
  const label = slotLabel(date, slot);

  const run = async (work: () => Promise<string | null>, thenBack = false) => {
    setBusy(true);
    try {
      const msg = await work();
      if (msg) toast(msg);
      if (thenBack) onBack();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: Favourite) =>
    run(async () => {
      await planMeal({ date, slot, favouriteId: f.id });
      return `${f.title} for ${label}`;
    }, true);

  return (
    <div className="meal-slot">
      <div className="meal-subhead">
        <button type="button" className="btn icon" aria-label="Back to the week" onClick={onBack}>
          <Svg>{MealIcon.prev}</Svg>
        </button>
        <h2 className="h2">{label}</h2>
      </div>

      {meal && (
        <div className="card meal-current">
          <div className="meal-current-head">
            <b className="h3">{meal.title}</b>
            {meal.source === 'calendar' && (
              <span className="chip neutral">
                <Svg>{MealIcon.calendar}</Svg> From the Meals calendar
              </span>
            )}
          </div>
          {meal.ingredients.length > 0 ? (
            <ul className="meal-ingredients" aria-label="Ingredients">
              {meal.ingredients.map((i) => (
                <li key={i} className="pill">
                  {i}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {meal.source === 'calendar'
                ? 'Pick a favourite or type a meal below to plan over it here, with ingredients.'
                : 'No ingredients. Edit the favourite or type the meal again with some.'}
            </p>
          )}
          <div className="meal-actions">
            {meal.ingredients.length > 0 && (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void run(async () => groceryToast(await mealToGrocery(date, slot)))}
              >
                <Svg>{MealIcon.cart}</Svg> Add ingredients to {week.groceryList?.name ?? 'Grocery'}
                {meal.unbought > 0 && <span className="meal-count">{meal.unbought}</span>}
              </button>
            )}
            {!picking && meal.source === 'mantel' && (
              <button type="button" className="btn" onClick={() => setPicking(true)}>
                Change
              </button>
            )}
            {meal.source === 'mantel' && (
              <button
                type="button"
                className="btn quiet"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await clearMeal(date, slot);
                    return `Cleared ${label}`;
                  }, true)
                }
              >
                <Svg>{MealIcon.trash}</Svg> Remove
              </button>
            )}
          </div>
        </div>
      )}

      {(picking || meal?.source === 'calendar') && (
        <Picker
          slot={slot}
          favourites={favourites}
          busy={busy}
          initialTitle={meal?.source === 'calendar' ? meal.title : ''}
          onPick={(f) => void pick(f)}
          onType={(title, ingredients, save) =>
            void run(async () => {
              if (save) {
                const { favourite } = await createFavourite({ title, slot, ingredients });
                await planMeal({ date, slot, favouriteId: favourite.id });
              } else await planMeal({ date, slot, title, ingredients });
              return `${title} for ${label}`;
            }, true)
          }
        />
      )}
    </div>
  );
}

function Picker({
  slot,
  favourites,
  busy,
  initialTitle,
  onPick,
  onType,
}: {
  slot: PlanSlot;
  favourites: Favourite[];
  busy: boolean;
  initialTitle: string;
  onPick: (f: Favourite) => void;
  onType: (title: string, ingredients: string[], saveAsFavourite: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [typing, setTyping] = useState(favourites.length === 0);
  const tags = allTags(favourites);
  const shown = favouritesFor(favourites, slot, query, tag);
  const recent = !query && !tag ? recentFavourites(favourites) : [];

  return (
    <div className="meal-picker">
      {favourites.length > 0 && (
        <>
          <div className="meal-search">
            <Svg>{MealIcon.search}</Svg>
            <input
              className="input"
              type="search"
              placeholder="Search favourites"
              aria-label="Search favourites"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {tags.length > 0 && (
            <div className="meal-tags scroll-x" role="group" aria-label="Tags">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn sm${tag === t ? ' selected' : ''}`}
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <>
              <div className="eyebrow">Recent</div>
              <div className="meal-recent">
                {recent.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => onPick(f)}
                  >
                    {f.title}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="eyebrow">Favourites</div>
          <div className="meal-favs">
            {shown.length === 0 && <p className="muted">No favourite matches.</p>}
            {shown.map((f) => (
              <button
                key={f.id}
                type="button"
                className="card tap meal-fav"
                disabled={busy}
                aria-label={`Plan ${f.title}`}
                onClick={() => onPick(f)}
              >
                <b>{f.title}</b>
                <span className="muted">
                  {f.ingredients.length
                    ? f.ingredients.slice(0, 5).join(', ') + (f.ingredients.length > 5 ? '…' : '')
                    : 'No ingredients'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {typing ? (
        <TypeMeal busy={busy} initialTitle={initialTitle} onSave={onType} />
      ) : (
        <button type="button" className="btn ghost block" onClick={() => setTyping(true)}>
          <Svg>{MealIcon.plus}</Svg> Type a meal
        </button>
      )}
    </div>
  );
}

function TypeMeal({
  busy,
  initialTitle,
  onSave,
}: {
  busy: boolean;
  initialTitle: string;
  onSave: (title: string, ingredients: string[], saveAsFavourite: boolean) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [ingredients, setIngredients] = useState('');
  const [save, setSave] = useState(true);
  const ok = title.trim().length > 0;
  return (
    <form
      className="card meal-type"
      aria-label="Type a meal"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(title.trim(), parseIngredients(ingredients), save);
      }}
    >
      <label className="meal-field">
        <span className="eyebrow">Meal</span>
        <input
          className="input"
          value={title}
          maxLength={80}
          placeholder="Chicken curry"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="meal-field">
        <span className="eyebrow">Ingredients, one per line or with commas</span>
        <textarea
          className="input meal-textarea"
          value={ingredients}
          rows={3}
          placeholder={'Chicken thighs\nCoconut milk\nRice'}
          onChange={(e) => setIngredients(e.target.value)}
        />
      </label>
      <div className="meal-actions">
        <button
          type="button"
          className="meal-check"
          role="checkbox"
          aria-checked={save}
          onClick={() => setSave(!save)}
        >
          <span className={`cb${save ? ' on' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          Save as a favourite
        </button>
        <span className="grow" />
        <button type="submit" className="btn primary" disabled={!ok || busy}>
          Plan it
        </button>
      </div>
    </form>
  );
}
