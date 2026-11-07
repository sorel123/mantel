/**
 * The favourites manager inside the planner: the list, and an editor for the title, the slot it
 * suits, the ingredients and tags. Deleting asks first; meals already planned keep their title
 * and ingredients.
 */
import { parseIngredients, type Favourite, type FavouriteSlot } from '@mantel/shared';
import { useState } from 'react';
import { useOverlay } from '../../app/overlay';
import { createFavourite, deleteFavourite, errorText, patchFavourite } from './data';
import { MealIcon, Svg } from './icons';

const SLOT_CHOICES: Array<[FavouriteSlot, string]> = [
  ['any', 'Any'],
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
];

export function FavouritesView({
  favourites,
  onBack,
}: {
  favourites: Favourite[];
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<Favourite | 'new' | null>(null);

  if (editing)
    return (
      <FavouriteEditor
        favourite={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
      />
    );

  return (
    <div className="meal-slot">
      <div className="meal-subhead">
        <button type="button" className="btn icon" aria-label="Back to the week" onClick={onBack}>
          <Svg>{MealIcon.prev}</Svg>
        </button>
        <h2 className="h2">Favourites</h2>
        <span className="grow" />
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <Svg>{MealIcon.plus}</Svg> New favourite
        </button>
      </div>
      {favourites.length === 0 ? (
        <div className="empty state compact meal-msg">
          No favourites yet. Add the meals you make often, with their ingredients, and plan a week
          in a few taps.
        </div>
      ) : (
        <div className="meal-favs" aria-label="Favourites">
          {favourites.map((f) => (
            <button
              key={f.id}
              type="button"
              className="card tap meal-fav"
              aria-label={`Edit ${f.title}`}
              onClick={() => setEditing(f)}
            >
              <b>{f.title}</b>
              <span className="muted">
                {[
                  f.slot === 'any' ? null : SLOT_CHOICES.find(([s]) => s === f.slot)![1],
                  `${f.ingredients.length} ${f.ingredients.length === 1 ? 'ingredient' : 'ingredients'}`,
                  ...f.tags,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FavouriteEditor({
  favourite,
  onDone,
}: {
  favourite: Favourite | null;
  onDone: () => void;
}) {
  const { toast, confirm } = useOverlay();
  const [title, setTitle] = useState(favourite?.title ?? '');
  const [slot, setSlot] = useState<FavouriteSlot>(favourite?.slot ?? 'dinner');
  const [ingredients, setIngredients] = useState(favourite?.ingredients.join('\n') ?? '');
  const [tags, setTags] = useState(favourite?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const ok = title.trim().length > 0;

  const save = async () => {
    setBusy(true);
    const body = {
      title: title.trim(),
      slot,
      ingredients: parseIngredients(ingredients),
      tags: tags
        .split(',')
        .map((t) => t.trim().slice(0, 24))
        .filter(Boolean)
        .slice(0, 10),
    };
    try {
      if (favourite) await patchFavourite(favourite.id, body);
      else await createFavourite(body);
      toast(`Saved ${body.title}`);
      onDone();
    } catch (err) {
      toast(errorText(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!favourite) return;
    const yes = await confirm({
      title: `Delete ${favourite.title}?`,
      body: 'Meals already planned from it stay on the plan with their ingredients.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await deleteFavourite(favourite.id);
      toast(`Deleted ${favourite.title}`);
      onDone();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <form
      className="meal-slot"
      aria-label={favourite ? `Edit ${favourite.title}` : 'New favourite'}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void save();
      }}
    >
      <div className="meal-subhead">
        <button type="button" className="btn icon" aria-label="Back to favourites" onClick={onDone}>
          <Svg>{MealIcon.prev}</Svg>
        </button>
        <h2 className="h2">{favourite ? 'Edit favourite' : 'New favourite'}</h2>
      </div>
      <div className="card meal-type">
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
        <div className="meal-field">
          <span className="eyebrow">Usually for</span>
          <div className="seg" role="group" aria-label="Usually for">
            {SLOT_CHOICES.map(([s, name]) => (
              <button
                key={s}
                type="button"
                className="btn"
                aria-pressed={slot === s}
                onClick={() => setSlot(s)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <label className="meal-field">
          <span className="eyebrow">Ingredients, one per line or with commas</span>
          <textarea
            className="input meal-textarea"
            value={ingredients}
            rows={5}
            placeholder={'Chicken thighs\nCoconut milk\nRice'}
            onChange={(e) => setIngredients(e.target.value)}
          />
        </label>
        <label className="meal-field">
          <span className="eyebrow">Tags, with commas</span>
          <input
            className="input"
            value={tags}
            placeholder="quick, kids love"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <div className="meal-actions">
          {favourite && (
            <button type="button" className="btn quiet" onClick={() => void remove()}>
              <Svg>{MealIcon.trash}</Svg> Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            Save
          </button>
        </div>
      </div>
    </form>
  );
}
