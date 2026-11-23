/**
 * Cook mode: one step at a time in large type, the ingredients beside it, and a one-tap kitchen
 * timer for any time a step mentions. While it is open the screen stays on (the dock's keep-awake
 * pin, which it hands back when it closes, unless someone had already pinned it).
 */
import { scaleIngredientText, stepTimers, type Recipe } from '@mantel/shared';
import { useEffect, useRef, useState } from 'react';
import { useKeepAwake } from '../../../app/keepAwake';
import { useOverlay } from '../../../app/overlay';
import { runPluginAction } from '../../../features/plugins/store';
import { MealIcon, Svg } from '../icons';
import { errorText } from './data';
import { RecipeIcon } from './icons';
import type { useStrikes } from './RecipePage';

/** Long enough for a slow braise; the pin lets go when cook mode closes anyway. */
const HOLD_MINUTES = 240;

export function CookMode({
  recipe,
  factor,
  strikes,
  onExit,
}: {
  recipe: Recipe;
  factor: number;
  strikes: ReturnType<typeof useStrikes>;
  onExit: () => void;
}) {
  const { toast } = useOverlay();
  const awake = useKeepAwake();
  const [step, setStep] = useState(0);
  const total = Math.max(1, recipe.steps.length);
  const text =
    recipe.steps[step] ?? 'No steps saved for this recipe. The ingredients are on the left.';
  const timers = stepTimers(text);

  // Hold the screen on while cooking; give it back only if this view took it.
  const tookPin = useRef(false);
  const { held, hold, release } = awake;
  useEffect(() => {
    if (!held) {
      hold(HOLD_MINUTES);
      tookPin.current = true;
    }
    return () => {
      if (tookPin.current) release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on entering cook mode
  }, []);

  // Arrow keys and a swipe-free layout: big Back and Next buttons do the paging.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(total - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const startTimer = async (seconds: number, label: string) => {
    try {
      await runPluginAction('timers', 'start', {
        seconds,
        label: `${recipe.title.slice(0, 40)}: step ${step + 1}`,
      });
      toast(`Timer set for ${label}`);
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="cook" aria-label={`Cooking ${recipe.title}`}>
      <div className="meal-subhead">
        <span className="chip cook-chip">
          <Svg>{RecipeIcon.flame}</Svg> Cook mode · screen stays on
        </span>
        <b className="cook-name">{recipe.title}</b>
        <span className="grow" />
        <button type="button" className="btn" onClick={onExit}>
          Done cooking
        </button>
      </div>

      <div className="cook-body">
        <aside className="card cook-ingredients" aria-label="Ingredients">
          <span className="eyebrow">Ingredients</span>
          <ul className="rp-list">
            {recipe.ingredients.map((ing, i) => {
              const k = `i${i}`;
              return (
                <li key={k}>
                  <button
                    type="button"
                    className={`rp-line${strikes.struck.has(k) ? ' struck' : ''}`}
                    aria-pressed={strikes.struck.has(k)}
                    onClick={() => strikes.toggle(k)}
                  >
                    {scaleIngredientText(ing.text, factor)}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="card cook-step" aria-live="polite">
          <div className="cook-progress" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={i < step ? 'done' : i === step ? 'now' : ''} />
            ))}
          </div>
          <span className="eyebrow tnum">
            Step {step + 1} of {total}
          </span>
          <p key={step} className="cook-text">
            {text}
          </p>
          {timers.length > 0 && (
            <div className="cook-timers">
              {timers.map((t) => (
                <button
                  key={t.seconds}
                  type="button"
                  className="btn"
                  onClick={() => void startTimer(t.seconds, t.label)}
                >
                  <Svg>{RecipeIcon.timer}</Svg> Set a timer for {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="cook-nav">
            <button
              type="button"
              className="btn lg"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              <Svg>{MealIcon.prev}</Svg> Back
            </button>
            <span className="grow" />
            {step < total - 1 ? (
              <button type="button" className="btn lg primary" onClick={() => setStep(step + 1)}>
                Next step <Svg>{MealIcon.next}</Svg>
              </button>
            ) : (
              <button type="button" className="btn lg primary" onClick={onExit}>
                <Svg>{RecipeIcon.check}</Svg> Finished
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
