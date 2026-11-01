import type { List } from '@mantel/shared';
import { Reorder, useDragControls } from 'framer-motion';
import { useRef, useState, type ReactNode } from 'react';
import { EmptyIcon, EmptyState } from '../../app/EmptyState';
import { useBootstrap } from '../../lib/bootstrap';
import { ChoreChart, Star } from './ChoreChart';
import { useChores, useLists } from './data';
import { ListCard } from './ListCard';
import './lists.css';

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
  const showChores = boot.flags.chores;
  const stars = chart?.stars.reduce((n, s) => n + s.stars, 0) ?? 0;

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
                {stars}
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
        <ChoreChart chart={chart} people={boot.people} onTap={(c) => void tap(c)} />
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
