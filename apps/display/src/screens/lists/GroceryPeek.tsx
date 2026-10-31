import type { List } from '@mantel/shared';
import { useLists } from './data';
import './lists.css';

/** The grocery list, or failing that the first list. */
export const groceryList = (lists: List[]) =>
  lists.find((l) => /grocer|shopping/i.test(l.name)) ?? lists[0];

/**
 * The Today screen's grocery card: the first four open items. Exported for the Today screen
 * (workstream 2) to place; tapping it should open the Lists screen.
 */
export function GroceryPeek({ onOpen }: { onOpen?: () => void }) {
  const { lists } = useLists();
  const list = lists && groceryList(lists);
  const open = list?.items.filter((i) => !i.done) ?? [];

  return (
    <button className="card gpeek" onClick={onOpen} aria-label={`${list?.name ?? 'Grocery'} list`}>
      <div className="top">
        <span className="h2">{list?.name ?? 'Grocery'}</span>
        <span className="n tnum">{list ? `${open.length} left` : ''}</span>
      </div>
      <ul>
        {open.slice(0, 4).map((i) => (
          <li key={i.id}>
            <i />
            {i.text}
          </li>
        ))}
        {list && open.length === 0 && <li className="none">Nothing needed</li>}
      </ul>
    </button>
  );
}
