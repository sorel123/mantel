import type { MonthPreset, TodayPreset } from '@mantel/shared';
import type { PresetLayout } from './Slots';

/**
 * Today's slots: `date` (the big date), `date-line` (one line of date), `date-huge` (the poster
 * masthead), `weather` (the card), `weather-line`, `daily` (the week ahead), `agenda` (full),
 * `agenda-short` (the timeline alone), `grocery`, `meals`, `countdowns`, `photo`, `people`
 * (a column per person), `bill` (the poster's event list), `add` (a round add button).
 */
export const todayLayouts: Record<TodayPreset, PresetLayout<TodayPreset>> = {
  agenda: {
    id: 'agenda',
    columns: '392px minmax(0, 1fr)',
    areas: '"side main"',
    regions: [
      { area: 'side', slots: ['date', 'weather', 'grocery'] },
      { area: 'main', slots: ['agenda'] },
    ],
  },
  weather: {
    id: 'weather',
    columns: 'minmax(0, 1fr) 400px',
    areas: '"wx main"',
    regions: [
      { area: 'wx', slots: ['date-line', 'weather', 'daily'] },
      { area: 'main', slots: ['agenda-short'] },
    ],
  },
  family: {
    id: 'family',
    rows: 'auto minmax(0, 1fr)',
    areas: '"top" "board"',
    gap: 'gap',
    regions: [
      { area: 'top', slots: ['date-line', 'weather-line', 'add'], direction: 'row' },
      { area: 'board', slots: ['people'] },
    ],
  },
  photo: {
    id: 'photo',
    columns: 'minmax(0, 1fr) 500px',
    areas: '"photo main"',
    regions: [
      { area: 'photo', slots: ['photo'] },
      { area: 'main', slots: ['agenda'] },
    ],
  },
  poster: {
    id: 'poster',
    rows: 'auto minmax(0, 1fr) auto',
    areas: '"head" "bill" "foot"',
    gap: 'gap',
    regions: [
      { area: 'head', slots: ['date-huge'] },
      { area: 'bill', slots: ['bill'] },
      { area: 'foot', slots: ['weather-line', 'meals'], direction: 'row' },
    ],
  },
};

/**
 * Today's Week view (the Day/Week switch on the agenda): the date and weather on one line,
 * the Month screen's seven-day strip across the whole width.
 */
export const todayWeekLayout: PresetLayout = {
  id: 'week',
  rows: 'auto minmax(0, 1fr)',
  areas: '"top" "board"',
  gap: 'gap',
  regions: [
    { area: 'top', slots: ['date-line', 'weather-line'], direction: 'row' },
    { area: 'board', slots: ['week-strip'] },
  ],
};

/** Month's slots: `month-grid` (six weeks) and `week-strip` (seven days with full agendas). */
export const monthLayouts: Record<MonthPreset, PresetLayout<MonthPreset>> = {
  grid: { id: 'grid', areas: '"cal"', regions: [{ area: 'cal', slots: ['month-grid'] }] },
  week: { id: 'week', areas: '"cal"', regions: [{ area: 'cal', slots: ['week-strip'] }] },
};
