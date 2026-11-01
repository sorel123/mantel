/**
 * The Custom layout: cards placed on a fixed grid (see `TodayCard` in @mantel/shared). Each
 * card is a region like a preset's, so the cards inside it style the same way; the region
 * carries its size in cells (`data-w`, `data-h`) for cards that change shape when small, and
 * `--card-zoom` to draw a small card's content a little smaller. Cards sit on half cells, so the
 * CSS grid has two tracks per cell.
 */
const PER = 1 / TODAY_CARD_STEP;
const track = (n: number) => Math.round(n * PER);
import { TODAY_CARD_STEP, TODAY_GRID_COLS, TODAY_GRID_ROWS, type TodayCard } from '@mantel/shared';
import type { CSSProperties, ReactNode } from 'react';
import './layout.css';

export function CardGrid({
  cards,
  render,
  zoom,
  className,
}: {
  cards: readonly TodayCard[];
  render: (card: TodayCard) => ReactNode;
  /** How much to shrink each card's content, 1 for none. */
  zoom?: (card: TodayCard) => number;
  className?: string;
}) {
  return (
    <div
      className={`slots card-grid${className ? ` ${className}` : ''}`}
      data-preset="custom"
      style={{
        gridTemplateColumns: `repeat(${TODAY_GRID_COLS * PER}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${TODAY_GRID_ROWS * PER}, minmax(0, 1fr))`,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.id}
          className="region"
          data-region={c.kind}
          data-w={c.w}
          data-h={c.h}
          style={
            {
              gridColumn: `${track(c.x) + 1} / span ${track(c.w)}`,
              gridRow: `${track(c.y) + 1} / span ${track(c.h)}`,
              '--card-zoom': zoom?.(c) ?? 1,
            } as CSSProperties
          }
        >
          {render(c)}
        </div>
      ))}
    </div>
  );
}
