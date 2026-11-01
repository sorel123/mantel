import type { Fit, MonthPreset, TodayPreset } from '@mantel/shared';

/**
 * Little wireframes of each preset, drawn on a 120 by 84 grid. Blocks are `--ink-3` and the
 * highlighted one (a photo, the big date) `--accent`, so they follow the look.
 */
type Rect = [x: number, y: number, w: number, h: number, accent?: boolean];

const todayThumbs: Record<TodayPreset, Rect[]> = {
  agenda: [
    [8, 8, 30, 14, true],
    [8, 28, 30, 24],
    [8, 58, 30, 18],
    [46, 8, 66, 68],
  ],
  weather: [
    [8, 8, 40, 8, true],
    [8, 22, 66, 26],
    [8, 54, 66, 22],
    [82, 8, 30, 68],
  ],
  family: [
    [8, 8, 40, 8, true],
    [8, 22, 22, 54],
    [35, 22, 22, 54],
    [62, 22, 22, 54],
    [89, 22, 23, 54],
  ],
  photo: [
    [8, 8, 56, 68, true],
    [72, 8, 40, 68],
  ],
  custom: [
    [8, 8, 34, 20, true],
    [8, 33, 34, 43],
    [47, 8, 65, 32],
    [47, 45, 30, 31],
    [82, 45, 30, 31],
  ],
  poster: [
    [8, 6, 34, 26, true],
    [78, 10, 34, 8],
    [8, 38, 104, 2],
    [8, 46, 104, 5],
    [8, 55, 104, 5],
    [8, 64, 104, 5],
    [8, 74, 104, 2],
  ],
};

const monthThumbs: Record<MonthPreset, Rect[]> = {
  grid: Array.from({ length: 42 }, (_, i): Rect => {
    const c = i % 7;
    const r = Math.floor(i / 7);
    return [8 + c * 15, 8 + r * 11.5, 13, 9.5, r === 2 && c === 4];
  }),
  week: Array.from({ length: 7 }, (_, i): Rect => [8 + i * 15, 8, 13, 68, i === 4]),
};

/** How the panel sits on a 16:9 screen in each fit, drawn as a screen with the panel in it. */
const fitThumbs: Record<Fit, Rect[]> = {
  fit: [
    [8, 8, 104, 68],
    [23, 8, 74, 68, true],
  ],
  fill: [
    [8, 8, 104, 68],
    [8, 8, 104, 68, true],
  ],
  scale: [
    [8, 8, 104, 68],
    [8, 8, 104, 68, true],
    [20, 20, 40, 10],
    [20, 36, 80, 6],
    [20, 46, 80, 6],
  ],
};

function Thumb({ rects }: { rects: Rect[] }) {
  return (
    <svg className="lay-thumb" viewBox="0 0 120 84" aria-hidden="true">
      {rects.map(([x, y, w, h, accent], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={h <= 2 ? 1 : 3}
          className={accent ? 'accent' : undefined}
        />
      ))}
    </svg>
  );
}

export const TodayThumb = ({ id }: { id: TodayPreset }) => <Thumb rects={todayThumbs[id]} />;
export const MonthThumb = ({ id }: { id: MonthPreset }) => <Thumb rects={monthThumbs[id]} />;
export const FitThumb = ({ id }: { id: Fit }) => <Thumb rects={fitThumbs[id]} />;
