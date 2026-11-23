/**
 * A recipe laid out for the kitchen: large type, the photo and what it takes on top, ingredients
 * on the left and steps on the right. Tap a line to strike it. The servings stepper rescales the
 * amounts (and what goes to the grocery list). "Plan this" picks a day and a slot; "Cook" opens
 * cook mode.
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
  type Recipe,
} from '@mantel/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useOverlay } from '../../../app/overlay';
import { dayNames } from '../../today/calendar';
import { mealAt, SLOT_NAME, useMealWeek } from '../data';
import { MealIcon, Svg } from '../icons';
import { CookMode } from './CookMode';
import {
  deleteRecipe,
  errorText,
  groceryText,
  patchRecipe,
  planRecipe,
  recipeToGrocery,
  siteOf,
  useRecipe,
} from './data';
import { RecipeIcon } from './icons';
import { RecipePhoto } from './RecipesView';
import './recipes.css';

/** Struck lines, kept while the sheet is open. */
export function useStrikes(resetKey: string) {
  const [struck, setStruck] = useState<Set<string>>(new Set());
  useEffect(() => setStruck(new Set()), [resetKey]);
  const toggle = (k: string) =>
    setStruck((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return { struck, toggle };
}

const VIA: Record<Recipe['via'], string> = {
  link: 'From the page',
  claude: 'Read by Claude',
  text: 'From pasted text',
  typed: 'Typed in',
};

export function RecipePage({
  id,
  onBack,
  backLabel = 'Back to recipes',
  context,
}: {
  id: string;
  onBack: () => void;
  backLabel?: string;
  /** Shown above the title when opened from a planned meal, with its own buttons. */
  context?: { label: string; actions: ReactNode };
}) {
  const [state] = useRecipe(id);
  const { toast, confirm } = useOverlay();
  const [servings, setServings] = useState<number | null>(null);
  const [cooking, setCooking] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const strikes = useStrikes(id);

  if (state.status === 'loading')
    return (
      <div className="rp">
        <div className="skeleton rp-skel-hero" />
        <div className="rp-cols">
          <div className="skeleton rp-skel-col" />
          <div className="skeleton rp-skel-col" />
        </div>
      </div>
    );
  if (state.status !== 'ready')
    return (
      <div className="meal-slot">
        <div className="meal-subhead">
          <button type="button" className="btn icon" aria-label={backLabel} onClick={onBack}>
            <Svg>{MealIcon.prev}</Svg>
          </button>
        </div>
        <div className="empty state compact meal-msg">
          {state.status === 'error' ? state.message : 'The meal planner is turned off.'}
        </div>
      </div>
    );

  const recipe = state.data;
  const wanted = servings ?? recipe.servings;
  const factor = scaleFactor(recipe.servings, wanted ?? undefined);

  if (cooking)
    return (
      <CookMode
        recipe={recipe}
        factor={factor}
        strikes={strikes}
        onExit={() => setCooking(false)}
      />
    );

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await work());
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const site = siteOf(recipe.sourceUrl);

  return (
    <div className="rp" aria-label={recipe.title}>
      <div className="meal-subhead">
        <button type="button" className="btn icon" aria-label={backLabel} onClick={onBack}>
          <Svg>{MealIcon.prev}</Svg>
        </button>
        {context && <span className="chip neutral rp-context">{context.label}</span>}
        <span className="grow" />
        {context?.actions}
        {!context && (
          <button type="button" className="btn" onClick={() => setPlanning((p) => !p)}>
            <Svg>{MealIcon.calendar}</Svg> Plan this
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => setCooking(true)}>
          <Svg>{RecipeIcon.flame}</Svg> Start cooking
        </button>
      </div>

      {planning && (
        <PlanPicker
          recipe={recipe}
          onDone={(msg) => {
            setPlanning(false);
            if (msg) toast(msg);
          }}
        />
      )}

      <header className="rp-hero">
        <RecipePhoto recipe={recipe} className="rp-photo" />
        <div className="rp-hero-text">
          <h2 className="rp-title">{recipe.title}</h2>
          <div className="rp-meta">
            {recipe.totalMinutes && (
              <span className="chip neutral">
                <Svg>{RecipeIcon.clock}</Svg> {minutesLabel(recipe.totalMinutes)}
              </span>
            )}
            {recipe.servings && (
              <span className="chip neutral">
                <Svg>{RecipeIcon.people}</Svg> Serves {recipe.servings}
              </span>
            )}
            {site && (
              <span className="chip neutral">
                <Svg>{RecipeIcon.link}</Svg> {site}
              </span>
            )}
            <span className="chip neutral">{VIA[recipe.via]}</span>
          </div>
          <Stars
            value={recipe.rating}
            onChange={(rating) =>
              void run(async () => {
                await patchRecipe(recipe.id, { rating });
                return rating ? `Rated ${rating} of 5` : 'Rating cleared';
              })
            }
          />
          {recipe.tags.length > 0 && (
            <div className="rp-tags">
              {recipe.tags.map((t) => (
                <span key={t} className="pill">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="rp-cols">
        <section className="card rp-ingredients" aria-label="Ingredients">
          <div className="rp-col-head">
            <h3 className="h3">Ingredients</h3>
            <span className="grow" />
            {recipe.servings && (
              <Stepper
                value={wanted!}
                onChange={setServings}
                label={(n) => `${n} ${n === 1 ? 'serving' : 'servings'}`}
              />
            )}
          </div>
          <ul className="rp-list">
            {recipe.ingredients.map((ing, i) => {
              const k = `i${i}`;
              const text = scaleIngredientText(ing.text, factor);
              return (
                <li key={k}>
                  <button
                    type="button"
                    className={`rp-line${strikes.struck.has(k) ? ' struck' : ''}`}
                    aria-pressed={strikes.struck.has(k)}
                    onClick={() => strikes.toggle(k)}
                  >
                    <span className={`cb${strikes.struck.has(k) ? ' on' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <span>{text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn primary block"
            disabled={busy || recipe.ingredients.length === 0}
            onClick={() =>
              void run(async () =>
                groceryText(
                  await recipeToGrocery(
                    recipe.id,
                    factor !== 1 ? (wanted ?? undefined) : undefined,
                  ),
                ),
              )
            }
          >
            <Svg>{MealIcon.cart}</Svg> Add ingredients to the grocery list
          </button>
        </section>

        <section className="card rp-steps" aria-label="Steps">
          <div className="rp-col-head">
            <h3 className="h3">Steps</h3>
          </div>
          {recipe.steps.length === 0 ? (
            <p className="muted">No steps saved. {recipe.sourceUrl ? 'The page has them.' : ''}</p>
          ) : (
            <ol className="rp-list rp-steplist">
              {recipe.steps.map((step, i) => {
                const k = `s${i}`;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      className={`rp-line rp-step${strikes.struck.has(k) ? ' struck' : ''}`}
                      aria-pressed={strikes.struck.has(k)}
                      onClick={() => strikes.toggle(k)}
                    >
                      <span className="rp-num tnum" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <Notes
        recipe={recipe}
        onSave={(notes) =>
          void run(async () => {
            await patchRecipe(recipe.id, { notes });
            return 'Notes saved';
          })
        }
      />

      {!context && (
        <div className="rp-foot">
          {recipe.lastCooked && (
            <span className="muted">
              Last made{' '}
              {fromIsoDate(recipe.lastCooked).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
          <span className="grow" />
          <button
            type="button"
            className="btn quiet"
            disabled={busy}
            onClick={() =>
              void (async () => {
                const ok = await confirm({
                  title: `Remove ${recipe.title}?`,
                  body: 'Meals already planned with it keep their name and ingredients.',
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                await run(async () => {
                  await deleteRecipe(recipe.id);
                  onBack();
                  return `Removed ${recipe.title}`;
                });
              })()
            }
          >
            <Svg>{MealIcon.trash}</Svg> Remove from the box
          </button>
        </div>
      )}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: (n: number) => string;
}) {
  return (
    <div className="rp-stepper" role="group" aria-label="Servings">
      <button
        type="button"
        className="btn icon"
        aria-label="Fewer servings"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <Svg>{RecipeIcon.minus}</Svg>
      </button>
      <span className="rp-stepper-value tnum" aria-live="polite">
        {label(value)}
      </span>
      <button
        type="button"
        className="btn icon"
        aria-label="More servings"
        disabled={value >= 100}
        onClick={() => onChange(Math.min(100, value + 1))}
      >
        <Svg>{MealIcon.plus}</Svg>
      </button>
    </div>
  );
}

function Stars({ value, onChange }: { value?: number; onChange: (n: number | null) => void }) {
  return (
    <div className="rp-stars" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`rp-star${value && n <= value ? ' on' : ''}`}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? null : n)}
        >
          <Svg>{RecipeIcon.star}</Svg>
        </button>
      ))}
    </div>
  );
}

function Notes({ recipe, onSave }: { recipe: Recipe; onSave: (notes: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(recipe.notes);
  useEffect(() => setText(recipe.notes), [recipe.notes]);
  if (!editing)
    return (
      <button type="button" className="card tap rp-notes" onClick={() => setEditing(true)}>
        <span className="eyebrow">Notes</span>
        <span className={recipe.notes ? '' : 'muted'}>
          {recipe.notes || 'Add a note: swaps, what the kids thought, how long it really took.'}
        </span>
      </button>
    );
  return (
    <form
      className="card rp-notes editing"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim());
        setEditing(false);
      }}
    >
      <span className="eyebrow">Notes</span>
      <textarea
        className="input"
        rows={3}
        maxLength={4000}
        aria-label="Notes"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="meal-actions">
        <span className="grow" />
        <button type="button" className="btn quiet" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Save
        </button>
      </div>
    </form>
  );
}

/** Pick a day (the next fourteen) and a slot, then plan it. */
function PlanPicker({ recipe, onDone }: { recipe: Recipe; onDone: (msg?: string) => void }) {
  const today = startOfDay(new Date());
  const [week] = useMealWeek(today);
  const [nextWeek] = useMealWeek(addDays(today, 7));
  const days = Array.from({ length: 14 }, (_, i) => toIsoDate(addDays(today, i)));
  const [date, setDate] = useState(days[0]!);
  const slots: PlanSlot[] = week.status === 'ready' ? week.data.slots : ['dinner'];
  const [slot, setSlot] = useState<PlanSlot>('dinner');
  const [busy, setBusy] = useState(false);
  const occupant = [week, nextWeek]
    .map((w) => (w.status === 'ready' ? mealAt(w.data, date, slot) : undefined))
    .find(Boolean);
  const dayLabel = (iso: string, i: number) =>
    i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[fromIsoDate(iso).getDay()]!.slice(0, 3);
  const name = `${dayNames[fromIsoDate(date).getDay()]} ${slot}`;

  return (
    <section className="card rp-plan" aria-label="Plan this recipe">
      <div className="rp-plan-days scroll-x" role="group" aria-label="Day">
        {days.map((d, i) => (
          <button
            key={d}
            type="button"
            className={`rp-day${d === date ? ' selected' : ''}`}
            aria-pressed={d === date}
            aria-label={`${dayNames[fromIsoDate(d).getDay()]} ${fromIsoDate(d).getDate()}`}
            onClick={() => setDate(d)}
          >
            <span className="eyebrow">{dayLabel(d, i)}</span>
            <b className="tnum">{fromIsoDate(d).getDate()}</b>
          </button>
        ))}
      </div>
      <div className="rp-plan-row">
        <div className="seg" role="group" aria-label="Meal">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              aria-pressed={slot === s}
              onClick={() => setSlot(s)}
            >
              {SLOT_NAME[s]}
            </button>
          ))}
        </div>
        <span className="muted grow">{occupant ? `Replaces ${occupant.title}` : ''}</span>
        <button type="button" className="btn quiet" onClick={() => onDone()}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await planRecipe(date, slot, recipe.id);
              onDone(`${recipe.title} for ${name}`);
            } catch (err) {
              onDone(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Plan for {name}
        </button>
      </div>
    </section>
  );
}
