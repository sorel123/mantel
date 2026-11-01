/**
 * The Custom layout: cards placed on a fixed grid (see `TodayCard` in @mantel/shared). Each
 * card is a region like a preset's, so the cards inside it style the same way; the region
 * carries its size in cells (`data-w`, `data-h`) for cards that change shape when small.
 */
import { TODAY_GRID_COLS, TODAY_GRID_ROWS, type TodayCard } from '@mantel/shared';
import type { ReactNode } from 'react';
import './layout.css';

export function CardGrid({
  cards,
  render,
  className,
}: {
  cards: readonly TodayCard[];
  render: (card: TodayCard) => ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`slots card-grid${className ? ` ${className}` : ''}`}
      data-preset="custom"
      style={{
        gridTemplateColumns: `repeat(${TODAY_GRID_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${TODAY_GRID_ROWS}, minmax(0, 1fr))`,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.id}
          className="region"
          data-region={c.kind}
          data-w={c.w}
          data-h={c.h}
          style={{
            gridColumn: `${c.x + 1} / span ${c.w}`,
            gridRow: `${c.y + 1} / span ${c.h}`,
          }}
        >
          {render(c)}
        </div>
      ))}
    </div>
  );
}
