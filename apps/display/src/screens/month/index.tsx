/**
 * Month, through the layout presets: Grid (six weeks) or Week strip (seven days with everything
 * in them). `?month=<preset>` on the display's address pins one. The Month/Week switch in the
 * header flips between them on the wall without touching the household setting; it goes back
 * to the setting when that changes.
 */
import type { MonthPreset } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { monthLayouts, Slots, useLayout } from '../../app/layout';
import { MonthGrid } from './MonthGrid';
import { WeekStrip } from './WeekStrip';
import './month.css';

export { gridStart } from './MonthGrid';
export { weekLabel, weekStart } from './WeekStrip';

/** Remembered while the display runs, so leaving Month and coming back keeps the choice. */
let chosen: { preset: MonthPreset; base: MonthPreset } | null = null;

export function MonthScreen() {
  const base = useLayout().monthPreset;
  const [pick, setPick] = useState<MonthPreset>(() =>
    chosen && chosen.base === base ? chosen.preset : base,
  );
  useEffect(() => {
    if (chosen && chosen.base !== base) chosen = null;
    setPick(chosen?.preset ?? base);
  }, [base]);
  const choose = (preset: MonthPreset) => {
    chosen = { preset, base };
    setPick(preset);
  };
  const toggle = <ViewToggle value={pick} onChange={choose} />;
  return (
    <Slots
      className="cal month"
      layout={monthLayouts[pick]}
      render={(slot) =>
        slot === 'month-grid' ? (
          <MonthGrid toggle={toggle} />
        ) : slot === 'week-strip' ? (
          <WeekStrip toggle={toggle} />
        ) : null
      }
    />
  );
}

const VIEWS: { id: MonthPreset; label: string }[] = [
  { id: 'grid', label: 'Month' },
  { id: 'week', label: 'Week' },
];

function ViewToggle({
  value,
  onChange,
}: {
  value: MonthPreset;
  onChange: (v: MonthPreset) => void;
}) {
  return (
    <div className="seg view-toggle" role="group" aria-label="Calendar view">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className="btn"
          aria-pressed={value === v.id}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
