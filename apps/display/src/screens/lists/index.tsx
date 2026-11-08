import type { List, Person } from '@mantel/shared';
import { Reorder, useDragControls } from 'framer-motion';
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { useOverlay } from '../../app/overlay';
import { useBootstrap } from '../../lib/bootstrap';
import { dimClass, useDimmed } from '../today/personFilter';
import { Avatar } from './Avatar';
import { CelebrationLayer, useCelebrate } from './celebrate';
import { ChoreChart, Star } from './ChoreChart';
import { useChores, useLists, useRoutines, useStars, type ChoreChart as Chart } from './data';
import { ListCard } from './ListCard';
import { RewardsDrawer } from './RewardsDrawer';
import { RoutineCard } from './RoutineCard';
import './lists.css';
import './rewards.css';

export { GroceryPeek } from './GroceryPeek';

type Tab = 'lists' | 'chores';

/** Lists side by side with a check animation and an add row, and the kids' chore chart. */
export function ListsScreen() {
  const boot = useBootstrap();
  const [tab, setTab] = useState<Tab>('lists');
  const { lists, error, toggle, add, setHome, moveLists, saveOrder } = useLists();
  // The order as dragged so far; saved when the finger lifts.
  const order = useRef<string[] | null>(null);
  const { chart, tap } = useChores();
  const stars = useStars();
  const showChores = boot.flags.chores;
  const color = useCallback(
    (id: string) => boot.people.find((p) => p.id === id)?.color,
    [boot.people],
  );
  const weekStars = chart?.stars.reduce((n, s) => n + s.stars, 0) ?? 0;

  return (
    <div className="lists-screen">
      {showChores && (
        <div className="ltabs" role="tablist" aria-label="Lists or chores">
          <button role="tab" aria-selected={tab === 'lists'} onClick={() => setTab('lists')}>
            Lists
          </button>
          <button role="tab" aria-selected={tab === 'chores'} onClick={() => setTab('chores')}>
            Chore chart
            {chart && (
              <span className="tstars tnum">
                <Star />
                {weekStars}
              </span>
            )}
          </button>
        </div>
      )}
      {tab === 'lists' || !showChores ? (
        lists ? (
          lists.length === 0 ? (
            <EmptyState icon={EmptyIcon.list} action="Set up lists" section="lists">
              No lists yet. Make a grocery list, a to-do list, or chores for the kids.
            </EmptyState>
          ) : (
            <Reorder.Group
              as="div"
              axis="x"
              className="lgrid"
              values={lists}
              onReorder={(next: List[]) => {
                order.current = next.map((l) => l.id);
                moveLists(next);
              }}
            >
              {lists.map((l) => (
                <DraggableList
                  key={l.id}
                  list={l}
                  onDrop={() => {
                    if (order.current) void saveOrder(order.current);
                    order.current = null;
                  }}
                >
                  {(handle) => (
                    <ListCard
                      list={l}
                      people={boot.people}
                      onToggle={toggle}
                      onAdd={(text) => void add(l.id, text)}
                      onHome={(home) => void setHome(l, home)}
                      handle={lists.length > 1 ? handle : undefined}
                    />
                  )}
                </DraggableList>
              ))}
            </Reorder.Group>
          )
        ) : (
          <div className="lstate">{error ? `Lists unavailable: ${error}` : 'Loading lists'}</div>
        )
      ) : chart ? (
        <CelebrationLayer settings={stars.celebrations} color={color}>
          <ChoresView
            chart={chart}
            people={boot.people}
            balances={stars.balances ?? []}
            onTap={(c) => void tap(c)}
          />
        </CelebrationLayer>
      ) : (
        <div className="lstate">Loading chores</div>
      )}
    </div>
  );
}

/**
 * A list card that moves sideways when dragged by its handle (the grip left of the name), so
 * taps and scrolling everywhere else on the card work as before.
 */
function DraggableList({
  list,
  onDrop,
  children,
}: {
  list: List;
  onDrop: () => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const handle = (
    <button
      type="button"
      className="lgrip"
      data-no-swipe
      aria-label={`Move ${list.name}`}
      title="Drag to reorder"
      onPointerDown={(e) => {
        e.preventDefault();
        controls.start(e);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </button>
  );
  return (
    <Reorder.Item
      as="div"
      className="lslot"
      value={list}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      whileDrag={{ scale: 1.02, zIndex: 5 }}
    >
      {children(handle)}
    </Reorder.Item>
  );
}

type ChoresMode = 'now' | 'week';

/**
 * The Chore chart tab: the routine for now (a big checklist) or the week's chart, and each
 * person's banked stars, which open the Rewards drawer.
 */
function ChoresView({
  chart,
  people,
  balances,
  onTap,
}: {
  chart: Chart;
  people: Person[];
  balances: NonNullable<ReturnType<typeof useStars>['balances']>;
  onTap: Parameters<typeof ChoreChart>[0]['onTap'];
}) {
  const overlay = useOverlay();
  const celebrate = useCelebrate();
  const dimmed = useDimmed();
  const { routines } = useRoutines();
  const hasRoutines = chart.chores.some((c) => c.cadence === 'daily' && c.timeOfDay !== 'any');
  const [picked, setMode] = useState<ChoresMode | null>(null);
  const mode: ChoresMode = picked ?? (hasRoutines ? 'now' : 'week');
  const kids = people.filter(
    (p) =>
      chart.chores.some((c) => c.personId === p.id) ||
      (balances.find((b) => b.personId === p.id)?.stars ?? 0) !== 0,
  );

  const openRewards = (personId?: string) =>
    overlay.openSheet(
      (close) => (
        <RewardsDrawer
          people={kids}
          initialPersonId={personId}
          celebrate={celebrate}
          close={close}
        />
      ),
      { label: 'Rewards', wide: true },
    );

  return (
    <div className="chores-view">
      {kids.length > 0 && (
        <div className="cbar">
          <div className="seg cmode" role="group" aria-label="Show">
            <button
              type="button"
              className="btn"
              aria-pressed={mode === 'now'}
              onClick={() => setMode('now')}
            >
              Routine now
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={mode === 'week'}
              onClick={() => setMode('week')}
            >
              This week
            </button>
          </div>
          <div className="cbank" role="group" aria-label="Banked stars">
            {kids.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`cbank-chip${dimClass(dimmed([p.id]))}`}
                style={{ '--pc': p.color } as CSSProperties}
                aria-label={`${p.name}: ${balances.find((b) => b.personId === p.id)?.stars ?? 0} stars banked. Rewards`}
                onClick={() => openRewards(p.id)}
              >
                <Avatar person={p} />
                <Star />
                <b className="tnum">{balances.find((b) => b.personId === p.id)?.stars ?? 0}</b>
              </button>
            ))}
            <button type="button" className="btn cbank-open" onClick={() => openRewards()}>
              Rewards
            </button>
          </div>
        </div>
      )}
      {mode === 'now' && kids.length > 0 ? (
        <RoutineCard chores={chart.chores} people={kids} routines={routines} onTap={onTap} />
      ) : (
        <ChoreChart
          chart={chart}
          people={people}
          onTap={onTap}
          routines={routines}
          balances={balances}
          onRewards={openRewards}
        />
      )}
    </div>
  );
}
