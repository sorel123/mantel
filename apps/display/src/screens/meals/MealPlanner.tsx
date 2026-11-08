/**
 * The meal planner sheet: this week as seven columns by the slots chosen in Settings (or dinner
 * only), a tap on a slot to pick a favourite or type a meal, ingredients to the grocery list per
 * meal or for the whole week, and the favourites manager. Opened with `useMealPlanner()`.
 */
import {
  fromIsoDate,
  startOfWeek,
  toIsoDate,
  type MealsWeekResponse,
  type PlannedMeal,
  type PlanSlot,
} from '@mantel/shared';
import { useState } from 'react';
import { SheetHeader, useOverlay } from '../../app/overlay';
import { dayNames, monthNames } from '../today/calendar';
import { FavouritesView } from './Favourites';
import { SlotView } from './SlotView';
import {
  errorText,
  groceryToast,
  mealAt,
  SLOT_NAME,
  slotLabel,
  shiftWeek,
  useFavourites,
  useMealWeek,
  weekToGrocery,
} from './data';
import { MealIcon, Svg } from './icons';
import './meals.css';

export type PlannerView =
  { kind: 'week' } | { kind: 'slot'; date: string; slot: PlanSlot } | { kind: 'favourites' };

/** `Nov 2 to 8`, or `Oct 27 to Nov 2` across months. */
function weekRange(days: string[]) {
  const a = fromIsoDate(days[0]!);
  const b = fromIsoDate(days[6]!);
  const m = (d: Date) => monthNames[d.getMonth()]!.slice(0, 3);
  return a.getMonth() === b.getMonth()
    ? `${m(a)} ${a.getDate()} to ${b.getDate()}`
    : `${m(a)} ${a.getDate()} to ${m(b)} ${b.getDate()}`;
}

export function MealPlannerBody({
  start,
  today,
  initial = { kind: 'week' },
  onClose,
}: {
  start: Date;
  today: Date;
  initial?: PlannerView;
  onClose: () => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(start));
  const [week] = useMealWeek(weekStart);
  const [favs] = useFavourites();
  const [view, setView] = useState<PlannerView>(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useOverlay();
  const thisWeek = toIsoDate(startOfWeek(today));

  const sendWeek = async (w: MealsWeekResponse) => {
    setBusy(true);
    try {
      toast(groceryToast(await weekToGrocery(w.weekStart)));
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const favourites = favs.status === 'ready' ? favs.data : [];
  const back = () => setView({ kind: 'week' });

  let body;
  if (week.status === 'off')
    body = (
      <div className="empty state compact meal-msg">
        The meal planner is turned off. Turn it on in Settings, Meals.
      </div>
    );
  else if (week.status === 'error')
    body = <div className="empty state compact meal-msg">{week.message}</div>;
  else if (week.status === 'loading') body = <div className="skeleton meal-skeleton" />;
  else if (view.kind === 'slot')
    body = (
      <SlotView
        week={week.data}
        date={view.date}
        slot={view.slot}
        favourites={favourites}
        onBack={back}
      />
    );
  else if (view.kind === 'favourites')
    body = <FavouritesView favourites={favourites} onBack={back} />;
  else
    body = (
      <>
        <div className="meal-toolbar">
          <div className="seg" role="group" aria-label="Week">
            <button
              type="button"
              className="btn icon"
              aria-label="Previous week"
              onClick={() => setWeekStart(shiftWeek(week.data.weekStart, -1))}
            >
              <Svg>{MealIcon.prev}</Svg>
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={week.data.weekStart === thisWeek}
              onClick={() => setWeekStart(startOfWeek(today))}
            >
              This week
            </button>
            <button
              type="button"
              className="btn icon"
              aria-label="Next week"
              onClick={() => setWeekStart(shiftWeek(week.data.weekStart, 1))}
            >
              <Svg>{MealIcon.next}</Svg>
            </button>
          </div>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => setView({ kind: 'favourites' })}>
            <Svg>{MealIcon.heart}</Svg> Favourites
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !week.data.groceryList}
            onClick={() => void sendWeek(week.data)}
          >
            <Svg>{MealIcon.cart}</Svg> Add the week to {week.data.groceryList?.name ?? 'Grocery'}
          </button>
        </div>
        <WeekGrid
          week={week.data}
          today={toIsoDate(today)}
          onSlot={(date, slot) => setView({ kind: 'slot', date, slot })}
        />
        {week.data.meals.length === 0 && (
          <p className="meal-hint">
            Nothing planned yet. Tap a slot to pick one of your favourites or type a meal.
          </p>
        )}
      </>
    );

  return (
    <div className="meal-planner">
      <SheetHeader
        title="Meals"
        subtitle={
          week.status === 'ready'
            ? `${week.data.weekStart === thisWeek ? 'This week' : 'Week of'} · ${weekRange(week.data.days)}`
            : undefined
        }
        onClose={onClose}
      />
      <div className="meal-body">{body}</div>
    </div>
  );
}

function WeekGrid({
  week,
  today,
  onSlot,
}: {
  week: MealsWeekResponse;
  today: string;
  onSlot: (date: string, slot: PlanSlot) => void;
}) {
  const single = week.slots.length === 1;
  return (
    <div
      className={`meal-grid${single ? ' single' : ''}`}
      aria-label="Meal plan"
      style={{ gridTemplateRows: `auto repeat(${week.slots.length}, 1fr)` }}
    >
      <div className="meal-row head">
        {!single && <span className="meal-corner" />}
        {week.days.map((d) => {
          const date = fromIsoDate(d);
          return (
            <div key={d} className={`meal-day${d === today ? ' today' : ''}`}>
              <span className="eyebrow">{dayNames[date.getDay()]!.slice(0, 3)}</span>
              <b className="tnum">{date.getDate()}</b>
            </div>
          );
        })}
      </div>
      {week.slots.map((slot) => (
        <div className="meal-row" key={slot}>
          {!single && <div className="meal-slot-name eyebrow">{SLOT_NAME[slot]}</div>}
          {week.days.map((d) => (
            <SlotCell
              key={d}
              meal={mealAt(week, d, slot)}
              label={slotLabel(d, slot)}
              today={d === today}
              onClick={() => onSlot(d, slot)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SlotCell({
  meal,
  label,
  today,
  onClick,
}: {
  meal: PlannedMeal | undefined;
  label: string;
  today: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`meal-cell${meal ? ` ${meal.source}` : ' empty'}${today ? ' today' : ''}`}
      aria-label={meal ? `${label}: ${meal.title}` : `Plan ${label}`}
      onClick={onClick}
    >
      {meal ? (
        <>
          <span className="meal-title">{meal.title}</span>
          <span className="meal-meta">
            {meal.source === 'calendar' && (
              <span className="meal-from" title="From the Meals calendar">
                <Svg>{MealIcon.calendar}</Svg>
              </span>
            )}
            {meal.unbought > 0 && (
              <span className="meal-buy" aria-label={`${meal.unbought} to buy`}>
                <Svg>{MealIcon.cart}</Svg>
                {meal.unbought}
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="meal-add">
          <Svg>{MealIcon.plus}</Svg>
        </span>
      )}
    </button>
  );
}
