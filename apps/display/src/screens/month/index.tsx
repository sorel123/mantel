/**
 * Month, through the layout presets: Grid (six weeks) or Week strip (seven days with everything
 * in them). `?month=<preset>` on the display's address pins one.
 */
import { monthLayouts, Slots, useLayout } from '../../app/layout';
import { MonthGrid } from './MonthGrid';
import { WeekStrip } from './WeekStrip';
import './month.css';

export { gridStart } from './MonthGrid';
export { weekLabel, weekStart } from './WeekStrip';

export function MonthScreen() {
  const preset = useLayout().monthPreset;
  return (
    <Slots
      className="cal month"
      layout={monthLayouts[preset]}
      render={(slot) =>
        slot === 'month-grid' ? <MonthGrid /> : slot === 'week-strip' ? <WeekStrip /> : null
      }
    />
  );
}
