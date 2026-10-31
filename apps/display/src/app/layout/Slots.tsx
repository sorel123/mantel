/**
 * The slot model. A preset is a CSS grid of named regions, each holding named slots in order;
 * the screen says what each slot renders. Presets rearrange the same cards, so the data hooks
 * behind them are shared and a new preset is a table entry plus some CSS.
 */
import { Fragment, type ReactNode } from 'react';
import './layout.css';

export interface Region {
  /** The grid area this region fills (see `areas`). */
  area: string;
  /** Slots in this region, top to bottom (or left to right with `direction: 'row'`). */
  slots: string[];
  direction?: 'column' | 'row';
}

export interface PresetLayout<Id extends string = string> {
  id: Id;
  /** `grid-template-columns`; defaults to one column. */
  columns?: string;
  /** `grid-template-rows`; defaults to one row that fills the screen. */
  rows?: string;
  /** `grid-template-areas`, one quoted string per row. */
  areas: string;
  /** Gap between regions, a token name without `--`; default `gap-lg`. */
  gap?: 'gap' | 'gap-lg';
  regions: Region[];
}

/** Renders a preset's grid and asks `render` for each slot. Unknown slots render nothing. */
export function Slots({
  layout,
  render,
  className,
}: {
  layout: PresetLayout;
  render: (slot: string) => ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`slots${className ? ` ${className}` : ''}`}
      data-preset={layout.id}
      style={{
        gridTemplateColumns: layout.columns ?? 'minmax(0, 1fr)',
        gridTemplateRows: layout.rows ?? 'minmax(0, 1fr)',
        gridTemplateAreas: layout.areas,
        gap: `var(--${layout.gap ?? 'gap-lg'})`,
      }}
    >
      {layout.regions.map((r) => (
        <div
          key={r.area}
          className={`region${r.direction === 'row' ? ' row' : ''}`}
          data-region={r.area}
          style={{ gridArea: r.area }}
        >
          {r.slots.map((s) => (
            <Fragment key={s}>{render(s)}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
