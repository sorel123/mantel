/**
 * Meals (v3 M): the planner sheet and the Today pieces that open it.
 *
 * - `useMealPlanner()` gives `open(view?)`, or null when the planner is turned off in Settings.
 * - `PlannerTap` makes anything (Tonight's row, the meals card) a button that opens it.
 * - `MealsWeekCard` is the `meals-week` card for the custom Today layout: the week's dinners.
 */
import {
  addDays,
  fromIsoDate,
  startOfDay,
  startOfWeek,
  toIsoDate,
  type Meal,
} from '@mantel/shared';
import { useCallback, type ReactNode } from 'react';
import { useNow } from '../../app/Clock';
import { useOverlay } from '../../app/overlay';
import { useBootstrap } from '../../lib/bootstrap';
import { dayNames, useMeals } from '../today/calendar';
import { MealIcon, Svg } from './icons';
import { MealPlannerBody, type PlannerView } from './MealPlanner';
import './meals.css';

export { MealPlannerBody, type PlannerView } from './MealPlanner';

/** Whether the meal planner plugin is on (missing means on). */
export function useMealsEnabled(): boolean {
  const boot = useBootstrap();
  return boot.settings.integrations?.meals?.enabled !== false;
}

/** Open the planner sheet on this week (or `view`); null when the planner is off. */
export function useMealPlanner(): ((view?: PlannerView, start?: Date) => void) | null {
  const { openSheet } = useOverlay();
  const enabled = useMealsEnabled();
  const open = useCallback(
    (view?: PlannerView, start?: Date) => {
      const today = startOfDay(new Date());
      openSheet(
        (close) => (
          <MealPlannerBody
            start={start ?? (view?.kind === 'slot' ? fromIsoDate(view.date) : today)}
            today={today}
            initial={view}
            onClose={close}
          />
        ),
        { wide: true, label: 'Meal planner' },
      );
    },
    [openSheet],
  );
  return enabled ? open : null;
}

/** Wrap Today's meal pieces so a tap opens the planner (tonight's dinner when `date` is given). */
export function PlannerTap({
  children,
  date,
  className = '',
}: {
  children: ReactNode;
  date?: Date;
  className?: string;
}) {
  const open = useMealPlanner();
  if (!open) return <>{children}</>;
  return (
    <button
      type="button"
      className={`meal-open ${className}`}
      aria-label="Open the meal planner"
      onClick={() =>
        open(date ? { kind: 'slot', date: toIsoDate(date), slot: 'dinner' } : undefined)
      }
    >
      {children}
    </button>
  );
}

const mainOf = (ms: Meal[]) => ms.find((m) => m.slot === 'dinner');

/** The week's dinners, Monday first, today marked. */
export function MealsWeekCard() {
  const now = useNow(60_000);
  const today = startOfDay(now);
  const { meals } = useMeals(today);
  const open = useMealPlanner();
  const monday = startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const todayIso = toIsoDate(today);

  const rows = days.map((d) => {
    const iso = toIsoDate(d);
    const dinner = mainOf(meals.filter((m) => m.date === iso));
    return (
      <li key={iso} className={iso === todayIso ? 'today' : iso < todayIso ? 'past' : ''}>
        <span className="eyebrow">{dayNames[d.getDay()]!.slice(0, 3)}</span>
        <span className={dinner ? 'meal-title' : 'meal-title none'}>
          {dinner?.title ?? 'Nothing planned'}
        </span>
      </li>
    );
  });

  const inner = (
    <>
      <div className="meals-week-head">
        <Svg>{MealIcon.meal}</Svg>
        <span className="eyebrow">Dinners this week</span>
      </div>
      <ol className="meals-week-list">{rows}</ol>
    </>
  );

  return open ? (
    <button
      type="button"
      className="card tap meals-week"
      aria-label="Dinners this week. Open the meal planner"
      onClick={() => open()}
    >
      {inner}
    </button>
  ) : (
    <div className="card meals-week" aria-label="Dinners this week">
      {inner}
    </div>
  );
}
