/**
 * The Recipes tab of the meal planner: a grid of recipe cards with photos, search and tags, and
 * the add panel (a link, a photo or pasted text).
 */
import { minutesLabel, type Recipe } from '@mantel/shared';
import { useState } from 'react';
import { MealIcon, Svg } from '../icons';
import { AddRecipe } from './AddRecipe';
import { filterRecipes, recipeImageUrl, recipeTags, useRecipes } from './data';
import { RecipeIcon } from './icons';
import './recipes.css';

export function RecipesView({
  onOpen,
  onBack,
}: {
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [box] = useRecipes();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const all = box.status === 'ready' ? box.data : [];
  const shown = filterRecipes(all, query, tag);
  const tags = recipeTags(all);
  const empty = box.status === 'ready' && all.length === 0;

  return (
    <div className="meal-slot recipes">
      <div className="meal-subhead">
        <button type="button" className="btn icon" aria-label="Back to the week" onClick={onBack}>
          <Svg>{MealIcon.prev}</Svg>
        </button>
        <h2 className="h2">Recipe box</h2>
        <span className="grow" />
        {!adding && !empty && (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            <Svg>{MealIcon.plus}</Svg> Add a recipe
          </button>
        )}
      </div>

      {(adding || empty) && (
        <AddRecipe
          onDone={(id) => {
            setAdding(false);
            if (id) onOpen(id);
          }}
          onCancel={empty ? undefined : () => setAdding(false)}
        />
      )}

      {box.status === 'loading' && (
        <div className="rc-grid" aria-label="Loading recipes">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rc-card skeleton" />
          ))}
        </div>
      )}
      {box.status === 'error' && <div className="empty state compact meal-msg">{box.message}</div>}
      {box.status === 'off' && (
        <div className="empty state compact meal-msg">
          The meal planner is turned off. Turn it on in Settings, Meals.
        </div>
      )}
      {empty && (
        <p className="meal-hint">
          The recipe box is empty. Paste a link from any recipe site and it lands here with its
          photo, ingredients and steps.
        </p>
      )}

      {all.length > 0 && (
        <>
          <div className="rc-filters">
            <div className="meal-search">
              <Svg>{MealIcon.search}</Svg>
              <input
                className="input"
                type="search"
                placeholder="Search recipes or ingredients"
                aria-label="Search recipes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {tags.length > 0 && (
              <div className="meal-tags scroll-x" role="group" aria-label="Recipe tags">
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
          </div>
          {shown.length === 0 ? (
            <div className="empty state compact meal-msg">No recipe matches “{query || tag}”.</div>
          ) : (
            <div className="rc-grid" aria-label="Recipe box">
              {shown.map((r, i) => (
                <RecipeCard key={r.id} recipe={r} index={i} onOpen={() => onOpen(r.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RecipePhoto({ recipe, className = '' }: { recipe: Recipe; className?: string }) {
  const src = recipeImageUrl(recipe);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`rc-photo${loaded || !src ? ' in' : ''} ${className}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
      ) : (
        <span className="rc-photo-none" aria-hidden="true">
          <Svg>{RecipeIcon.book}</Svg>
        </span>
      )}
    </div>
  );
}

function RecipeCard({
  recipe,
  index,
  onOpen,
}: {
  recipe: Recipe;
  index: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="card tap rc-card"
      style={{ animationDelay: `calc(var(--fast) * ${Math.min(index, 8) / 3})` }}
      aria-label={`Open ${recipe.title}`}
      onClick={onOpen}
    >
      <RecipePhoto recipe={recipe} />
      <span className="rc-body">
        <b className="rc-title">{recipe.title}</b>
        <span className="rc-meta">
          {recipe.totalMinutes && (
            <span>
              <Svg>{RecipeIcon.clock}</Svg>
              {minutesLabel(recipe.totalMinutes)}
            </span>
          )}
          {recipe.servings && (
            <span>
              <Svg>{RecipeIcon.people}</Svg>
              {recipe.servings}
            </span>
          )}
          {recipe.rating && (
            <span className="rc-stars" aria-label={`${recipe.rating} stars`}>
              <Svg>{RecipeIcon.star}</Svg>
              {recipe.rating}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
